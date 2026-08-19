use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::Ordering;
use std::time::Duration;

use image::ImageReader;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::{
    JobControl, UpscaleFailure, ERROR_CANCELLED, ERROR_IMAGE_TOO_LARGE, ERROR_INTERNAL,
    ERROR_SIDECAR_FAILED, ERROR_SIDECAR_UNAVAILABLE, MAX_OUTPUT_BYTES, MAX_OUTPUT_PIXELS,
};

const REAL_ESRGAN_BINARY_NAME: &str = "realesrgan-ncnn-vulkan";
pub(super) const REAL_ESRGAN_MODEL_NAME: &str = "realesrgan-x4plus";

pub(super) fn resolve_sidecar_binary() -> Result<PathBuf, UpscaleFailure> {
    let executable_name = platform_binary_name(REAL_ESRGAN_BINARY_NAME);
    if let Ok(current_executable) = std::env::current_exe() {
        if let Some(directory) = current_executable.parent() {
            let bundled_path = directory.join(&executable_name);
            if bundled_path.is_file() {
                return Ok(bundled_path);
            }
        }
    }

    let development_path =
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(platform_binary_name(&format!(
                "{REAL_ESRGAN_BINARY_NAME}-{}",
                env!("LUMINA_TARGET_TRIPLE")
            )));
    if development_path.is_file() {
        return Ok(development_path);
    }

    Err(UpscaleFailure::new(
        ERROR_SIDECAR_UNAVAILABLE,
        format!(
            "Real-ESRGAN sidecar is unavailable; expected bundled binary or {}",
            development_path.display()
        ),
    ))
}

pub(super) fn resolve_model_dir(app: &AppHandle) -> Result<PathBuf, UpscaleFailure> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend([
            resource_dir
                .join("resources")
                .join("realesrgan")
                .join("models"),
            resource_dir.join("realesrgan").join("models"),
            resource_dir.join("models"),
        ]);
    }
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("realesrgan")
            .join("models"),
    );

    candidates
        .into_iter()
        .find(|candidate| has_required_model_files(candidate))
        .ok_or_else(|| {
            UpscaleFailure::new(
                ERROR_SIDECAR_UNAVAILABLE,
                "Real-ESRGAN model resources are unavailable",
            )
        })
}

pub(super) fn model_sha256(model_dir: &Path) -> Result<String, UpscaleFailure> {
    let mut hasher = Sha256::new();
    for file_name in [
        format!("{REAL_ESRGAN_MODEL_NAME}.param"),
        format!("{REAL_ESRGAN_MODEL_NAME}.bin"),
    ] {
        let bytes = fs::read(model_dir.join(&file_name)).map_err(|error| {
            UpscaleFailure::new(
                ERROR_SIDECAR_UNAVAILABLE,
                format!("failed to read model file {file_name}: {error}"),
            )
        })?;
        hasher.update(file_name.as_bytes());
        hasher.update([0]);
        hasher.update(bytes);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub(super) fn run_sidecar(
    binary_path: &Path,
    model_dir: &Path,
    input_path: &Path,
    output_path: &Path,
    scale: u8,
    control: &JobControl,
) -> Result<(), UpscaleFailure> {
    let mut command = Command::new(binary_path);
    command
        .arg("-i")
        .arg(input_path)
        .arg("-o")
        .arg(output_path)
        .arg("-n")
        .arg(REAL_ESRGAN_MODEL_NAME)
        .arg("-m")
        .arg(model_dir)
        .arg("-s")
        .arg(scale.to_string())
        .arg("-t")
        .arg("0")
        .arg("-g")
        .arg("auto")
        .arg("-j")
        .arg("1:2:2")
        .arg("-f")
        .arg("png")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_sidecar_process(&mut command);

    let child = command.spawn().map_err(|error| {
        UpscaleFailure::new(
            ERROR_SIDECAR_UNAVAILABLE,
            format!("failed to start Real-ESRGAN sidecar: {error}"),
        )
    })?;
    {
        let mut child_slot = control.child.lock().map_err(|_| {
            UpscaleFailure::new(ERROR_INTERNAL, "sidecar process state lock is unavailable")
        })?;
        *child_slot = Some(child);
    }

    let result = loop {
        if control.cancel_requested.load(Ordering::Acquire) {
            if let Ok(mut child_slot) = control.child.lock() {
                if let Some(child) = child_slot.as_mut() {
                    terminate_and_reap(child);
                }
            }
            break Err(UpscaleFailure::new(
                ERROR_CANCELLED,
                "sidecar was cancelled",
            ));
        }
        let status = {
            let mut child_slot = control.child.lock().map_err(|_| {
                UpscaleFailure::new(ERROR_INTERNAL, "sidecar process state lock is unavailable")
            })?;
            let child = child_slot.as_mut().ok_or_else(|| {
                UpscaleFailure::new(ERROR_INTERNAL, "sidecar process handle disappeared")
            })?;
            child.try_wait().map_err(|error| {
                UpscaleFailure::new(
                    ERROR_SIDECAR_FAILED,
                    format!("failed to inspect sidecar: {error}"),
                )
            })?
        };
        if let Some(status) = status {
            if status.success() {
                break Ok(());
            }
            break Err(UpscaleFailure::new(
                ERROR_SIDECAR_FAILED,
                format!("Real-ESRGAN sidecar exited with {status}"),
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    };

    if let Ok(mut child_slot) = control.child.lock() {
        *child_slot = None;
    }
    result
}

pub(super) fn validate_sidecar_output(
    path: &Path,
    expected_width: u32,
    expected_height: u32,
) -> Result<(), UpscaleFailure> {
    let metadata = fs::metadata(path).map_err(|error| {
        UpscaleFailure::new(
            ERROR_SIDECAR_FAILED,
            format!("sidecar did not write an output file: {error}"),
        )
    })?;
    if metadata.len() == 0 || metadata.len() > MAX_OUTPUT_BYTES {
        return Err(UpscaleFailure::new(
            ERROR_IMAGE_TOO_LARGE,
            "sidecar output is empty or exceeds the maximum size",
        ));
    }
    let (width, height) = ImageReader::open(path)
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_SIDECAR_FAILED,
                format!("failed to read sidecar output: {error}"),
            )
        })?
        .with_guessed_format()
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_SIDECAR_FAILED,
                format!("failed to detect sidecar output: {error}"),
            )
        })?
        .into_dimensions()
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_SIDECAR_FAILED,
                format!("invalid sidecar output: {error}"),
            )
        })?;
    let output_pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| {
            UpscaleFailure::new(ERROR_IMAGE_TOO_LARGE, "sidecar output dimensions overflow")
        })?;
    if output_pixels > MAX_OUTPUT_PIXELS {
        return Err(UpscaleFailure::new(
            ERROR_IMAGE_TOO_LARGE,
            "sidecar output exceeds the maximum pixel count",
        ));
    }
    if width != expected_width || height != expected_height {
        return Err(UpscaleFailure::new(
            ERROR_SIDECAR_FAILED,
            format!(
                "sidecar output dimensions {width}x{height} do not match expected {expected_width}x{expected_height}"
            ),
        ));
    }
    Ok(())
}

fn has_required_model_files(directory: &Path) -> bool {
    directory
        .join(format!("{REAL_ESRGAN_MODEL_NAME}.param"))
        .is_file()
        && directory
            .join(format!("{REAL_ESRGAN_MODEL_NAME}.bin"))
            .is_file()
}

fn terminate_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(target_os = "windows")]
fn platform_binary_name(base: &str) -> String {
    format!("{base}.exe")
}

#[cfg(not(target_os = "windows"))]
fn platform_binary_name(base: &str) -> String {
    base.to_string()
}

#[cfg(target_os = "windows")]
fn configure_sidecar_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn configure_sidecar_process(_command: &mut Command) {}

#[cfg(test)]
mod tests {
    use std::fs;

    use image::RgbaImage;
    use uuid::Uuid;

    use super::*;

    #[test]
    fn rejects_sidecar_output_with_unexpected_dimensions() {
        let path =
            std::env::temp_dir().join(format!("lumina-upscale-output-{}.png", Uuid::new_v4()));
        RgbaImage::new(2, 2)
            .save(&path)
            .expect("write output image");

        let error = validate_sidecar_output(&path, 4, 4).expect_err("reject wrong dimensions");

        assert_eq!(error.code, ERROR_SIDECAR_FAILED);
        let _ = fs::remove_file(path);
    }
}
