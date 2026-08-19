use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::Ordering;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use image::ImageReader;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tracing::{info, warn};

use super::{
    JobControl, UpscaleFailure, ERROR_CANCELLED, ERROR_GPU_UNAVAILABLE, ERROR_IMAGE_TOO_LARGE,
    ERROR_INTERNAL, ERROR_SIDECAR_FAILED, ERROR_SIDECAR_UNAVAILABLE, MAX_OUTPUT_BYTES,
    MAX_OUTPUT_EDGE, MAX_OUTPUT_PIXELS,
};

const REAL_ESRGAN_BINARY_NAME: &str = "realesrgan-ncnn-vulkan";
pub(super) const REAL_ESRGAN_ENGINE_VERSION: &str =
    "realesrgan-ncnn-vulkan-v0.2.0-37026f49-ncnn-6125c9f4";
pub(super) const REAL_ESRGAN_MODEL_NAME: &str = "realesrgan-x4plus";
const MAX_SIDECAR_DIAGNOSTIC_BYTES: usize = 4 * 1024;

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
    job_id: &str,
    binary_path: &Path,
    model_dir: &Path,
    input_path: &Path,
    output_path: &Path,
    scale: u8,
    input_width: u32,
    input_height: u32,
    expected_width: u32,
    expected_height: u32,
    model_sha256: &str,
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
        .arg("-v")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_sidecar_process(&mut command);

    let started_at = Instant::now();
    info!(
        %job_id,
        scale,
        input_width,
        input_height,
        output_width = expected_width,
        output_height = expected_height,
        engine_version = REAL_ESRGAN_ENGINE_VERSION,
        model_sha256 = %model_sha256,
        "upscale.engine.spawn"
    );
    let mut child = command.spawn().map_err(|error| {
        UpscaleFailure::new(
            ERROR_SIDECAR_UNAVAILABLE,
            format!("failed to start Real-ESRGAN sidecar: {error}"),
        )
    })?;
    let stdout_reader = child.stdout.take().map(spawn_sidecar_output_reader);
    let stderr_reader = child.stderr.take().map(spawn_sidecar_output_reader);
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
            break Ok(status);
        }
        std::thread::sleep(Duration::from_millis(100));
    };

    if let Ok(mut child_slot) = control.child.lock() {
        *child_slot = None;
    }
    let stdout = read_sidecar_output(stdout_reader);
    let stderr = read_sidecar_output(stderr_reader);
    let diagnostics = format!("{stdout}\n{stderr}");
    let elapsed_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

    match result {
        Ok(status) if status.success() => {
            info!(%job_id, %status, elapsed_ms, "upscale.engine.exit");
            Ok(())
        }
        Ok(status) => {
            let diagnostic_category = sidecar_diagnostic_category(&diagnostics);
            warn!(
                %job_id,
                %status,
                elapsed_ms,
                diagnostic_category,
                stdout_diagnostic = %redact_sidecar_output(&stdout),
                stderr_diagnostic = %redact_sidecar_output(&stderr),
                "upscale.engine.exit"
            );
            let error_code = if diagnostic_category == "gpu_or_vulkan" {
                ERROR_GPU_UNAVAILABLE
            } else {
                ERROR_SIDECAR_FAILED
            };
            Err(UpscaleFailure::new(
                error_code,
                format!("Real-ESRGAN sidecar exited with {status} ({diagnostic_category})"),
            ))
        }
        Err(error) => {
            warn!(%job_id, elapsed_ms, error_code = error.code, "upscale.engine.exit");
            Err(error)
        }
    }
}

fn spawn_sidecar_output_reader<R>(mut reader: R) -> JoinHandle<String>
where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut retained = Vec::with_capacity(MAX_SIDECAR_DIAGNOSTIC_BYTES);
        let mut buffer = [0_u8; 1024];
        loop {
            let read = match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            let remaining = MAX_SIDECAR_DIAGNOSTIC_BYTES.saturating_sub(retained.len());
            retained.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        String::from_utf8_lossy(&retained).into_owned()
    })
}

fn read_sidecar_output(reader: Option<JoinHandle<String>>) -> String {
    reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default()
}

fn sidecar_diagnostic_category(diagnostics: &str) -> &'static str {
    let diagnostics = diagnostics.to_ascii_lowercase();
    if diagnostics.contains("vulkan")
        || diagnostics.contains("vkcreate")
        || diagnostics.contains("invalid gpu device")
        || diagnostics.contains("no gpu")
    {
        "gpu_or_vulkan"
    } else if diagnostics.contains("model") {
        "model"
    } else if diagnostics.contains("decode") || diagnostics.contains("encode") {
        "image_io"
    } else {
        "unknown"
    }
}

fn redact_sidecar_output(output: &str) -> String {
    let mut redacted = String::new();
    for token in output.split_whitespace() {
        if !redacted.is_empty() {
            redacted.push(' ');
        }
        redacted.push_str(if looks_like_local_path(token) {
            "<path>"
        } else {
            token
        });
        if redacted.len() >= 512 {
            redacted.truncate(512);
            break;
        }
    }
    if redacted.is_empty() {
        "(empty)".to_string()
    } else {
        redacted
    }
}

fn looks_like_local_path(token: &str) -> bool {
    let token = token.trim_matches(|character: char| {
        matches!(
            character,
            '"' | '\'' | '(' | ')' | '[' | ']' | ',' | ':' | ';'
        )
    });
    let lower = token.to_ascii_lowercase();
    token.contains('\\')
        || token.starts_with('/')
        || token.starts_with("./")
        || token.starts_with("../")
        || lower.starts_with("file://")
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".webp")
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
    if width > MAX_OUTPUT_EDGE || height > MAX_OUTPUT_EDGE {
        return Err(UpscaleFailure::new(
            ERROR_IMAGE_TOO_LARGE,
            "sidecar output exceeds the maximum edge length",
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
    ImageReader::open(path)
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_SIDECAR_FAILED,
                format!("failed to re-open sidecar output: {error}"),
            )
        })?
        .with_guessed_format()
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_SIDECAR_FAILED,
                format!("failed to re-detect sidecar output: {error}"),
            )
        })?
        .decode()
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_SIDECAR_FAILED,
                format!("failed to fully decode sidecar output: {error}"),
            )
        })?;
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

pub(super) fn terminate_and_reap(child: &mut Child) {
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

    #[test]
    fn rejects_truncated_sidecar_output_even_when_header_dimensions_match() {
        let path =
            std::env::temp_dir().join(format!("lumina-upscale-truncated-{}.png", Uuid::new_v4()));
        RgbaImage::new(4, 4)
            .save(&path)
            .expect("write output image");
        let mut bytes = fs::read(&path).expect("read output image");
        bytes.truncate(33); // PNG signature plus IHDR: dimensions remain readable, pixels do not.
        fs::write(&path, bytes).expect("truncate output image");

        let error =
            validate_sidecar_output(&path, 4, 4).expect_err("reject truncated image output");

        assert_eq!(error.code, ERROR_SIDECAR_FAILED);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn redacts_local_paths_from_sidecar_diagnostics() {
        let redacted = redact_sidecar_output(
            "vkCreateInstance failed at C:\\Users\\person\\input.png and /private/tmp/upscaled.png",
        );

        assert!(redacted.contains("vkCreateInstance failed"));
        assert!(!redacted.contains("Users"));
        assert!(!redacted.contains("/private"));
    }

    #[test]
    fn classifies_vulkan_sidecar_diagnostics_without_exposing_them_to_the_ui() {
        assert_eq!(
            sidecar_diagnostic_category("vkCreateInstance failed while initializing Vulkan"),
            "gpu_or_vulkan"
        );
        assert_eq!(
            sidecar_diagnostic_category("unrecognized failure"),
            "unknown"
        );
    }
}
