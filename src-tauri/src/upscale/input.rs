use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::{DynamicImage, ImageDecoder, ImageReader};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use url::Url;

use super::{
    JobRequest, StartUpscaleJobRequest, UpscaleFailure, ERROR_CACHE_FAILED, ERROR_IMAGE_TOO_LARGE,
    ERROR_INVALID_INPUT_SOURCE, ERROR_INVALID_SCALE, ERROR_MISSING_INPUT,
    ERROR_UNSUPPORTED_COLOR_PROFILE, ERROR_UNSUPPORTED_IMAGE, MAX_OUTPUT_PIXELS,
};

const MAX_INPUT_BYTES: u64 = 512 * 1024 * 1024;

pub(super) struct PreparedInput {
    pub(super) normalized_path: PathBuf,
    pub(super) source_sha256: String,
    pub(super) expected_width: u32,
    pub(super) expected_height: u32,
}

pub(super) fn validate_start_request(
    app: &AppHandle,
    request: StartUpscaleJobRequest,
) -> Result<JobRequest, UpscaleFailure> {
    if request.source_image_url.trim().is_empty() {
        return Err(UpscaleFailure::new(
            ERROR_MISSING_INPUT,
            "source image URL is empty",
        ));
    }
    if !matches!(request.scale, 2 | 4) {
        return Err(UpscaleFailure::new(
            ERROR_INVALID_SCALE,
            "scale must be 2 or 4",
        ));
    }
    if !is_safe_project_id(&request.project_id) {
        return Err(UpscaleFailure::new(
            ERROR_INVALID_INPUT_SOURCE,
            "project id contains unsupported characters",
        ));
    }
    if !crate::commands::project_state::project_record_exists(app, &request.project_id).map_err(
        |error| {
            UpscaleFailure::new(
                ERROR_INVALID_INPUT_SOURCE,
                format!("failed to verify project: {error}"),
            )
        },
    )? {
        return Err(UpscaleFailure::new(
            ERROR_INVALID_INPUT_SOURCE,
            "project record does not exist",
        ));
    }

    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        UpscaleFailure::new(
            ERROR_INVALID_INPUT_SOURCE,
            format!("failed to resolve app data directory: {error}"),
        )
    })?;
    let project_dir = app_data_dir.join("projects").join(&request.project_id);
    let project_dir = project_dir.canonicalize().map_err(|error| {
        UpscaleFailure::new(
            ERROR_INVALID_INPUT_SOURCE,
            format!("failed to resolve project directory: {error}"),
        )
    })?;
    let source_path = source_url_to_path(&request.source_image_url)?;
    let source_path = source_path.canonicalize().map_err(|error| {
        UpscaleFailure::new(
            ERROR_INVALID_INPUT_SOURCE,
            format!("failed to resolve image source: {error}"),
        )
    })?;
    if !source_path.is_file() {
        return Err(UpscaleFailure::new(
            ERROR_INVALID_INPUT_SOURCE,
            "source path is not a file",
        ));
    }

    let uploads_dir = project_dir.join("uploads");
    let outputs_dir = project_dir.join("outputs").join("images");
    if !is_within(&source_path, &uploads_dir) && !is_within(&source_path, &outputs_dir) {
        return Err(UpscaleFailure::new(
            ERROR_INVALID_INPUT_SOURCE,
            "source path is outside this project's authorized image directories",
        ));
    }

    Ok(JobRequest {
        project_dir,
        source_path,
        scale: request.scale,
    })
}

pub(super) fn preprocess_source(
    source_path: &Path,
    work_dir: &Path,
    scale: u8,
) -> Result<PreparedInput, UpscaleFailure> {
    let metadata = fs::metadata(source_path).map_err(|error| {
        UpscaleFailure::new(
            ERROR_INVALID_INPUT_SOURCE,
            format!("failed to inspect source: {error}"),
        )
    })?;
    if metadata.len() == 0 {
        return Err(UpscaleFailure::new(
            ERROR_MISSING_INPUT,
            "source file is empty",
        ));
    }
    if metadata.len() > MAX_INPUT_BYTES {
        return Err(UpscaleFailure::new(
            ERROR_IMAGE_TOO_LARGE,
            "source file exceeds maximum supported size",
        ));
    }
    let bytes = fs::read(source_path).map_err(|error| {
        UpscaleFailure::new(
            ERROR_INVALID_INPUT_SOURCE,
            format!("failed to read source: {error}"),
        )
    })?;
    let mut image = decode_srgb_image(&bytes)?;
    let expected_width = image
        .width()
        .checked_mul(u32::from(scale))
        .ok_or_else(|| UpscaleFailure::new(ERROR_IMAGE_TOO_LARGE, "scaled width overflows"))?;
    let expected_height = image
        .height()
        .checked_mul(u32::from(scale))
        .ok_or_else(|| UpscaleFailure::new(ERROR_IMAGE_TOO_LARGE, "scaled height overflows"))?;
    let output_pixels = u64::from(expected_width)
        .checked_mul(u64::from(expected_height))
        .ok_or_else(|| UpscaleFailure::new(ERROR_IMAGE_TOO_LARGE, "scaled dimensions overflow"))?;
    if output_pixels > MAX_OUTPUT_PIXELS {
        return Err(UpscaleFailure::new(
            ERROR_IMAGE_TOO_LARGE,
            "scaled image exceeds maximum pixel count",
        ));
    }

    let normalized_path = work_dir.join("input.png");
    write_png_atomically(&mut image, &normalized_path)?;
    let source_sha256 = fs::read(&normalized_path)
        .map(|normalized_bytes| sha256_hex(&normalized_bytes))
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to hash normalized input: {error}"),
            )
        })?;
    Ok(PreparedInput {
        normalized_path,
        source_sha256,
        expected_width,
        expected_height,
    })
}

fn decode_srgb_image(bytes: &[u8]) -> Result<DynamicImage, UpscaleFailure> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_UNSUPPORTED_IMAGE,
                format!("failed to detect image format: {error}"),
            )
        })?;
    let mut decoder = reader.into_decoder().map_err(|error| {
        UpscaleFailure::new(
            ERROR_UNSUPPORTED_IMAGE,
            format!("failed to open image decoder: {error}"),
        )
    })?;
    if !is_supported_color_type(decoder.color_type()) {
        return Err(UpscaleFailure::new(
            ERROR_UNSUPPORTED_COLOR_PROFILE,
            "only RGB or RGBA source images are supported",
        ));
    }
    if let Some(profile) = decoder.icc_profile().map_err(|error| {
        UpscaleFailure::new(
            ERROR_UNSUPPORTED_COLOR_PROFILE,
            format!("failed to read embedded ICC profile: {error}"),
        )
    })? {
        if !is_srgb_icc_profile(&profile) {
            return Err(UpscaleFailure::new(
                ERROR_UNSUPPORTED_COLOR_PROFILE,
                "embedded ICC profile is not a confirmed sRGB profile",
            ));
        }
    }
    let orientation = decoder.orientation().map_err(|error| {
        UpscaleFailure::new(
            ERROR_UNSUPPORTED_IMAGE,
            format!("failed to read image orientation: {error}"),
        )
    })?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|error| {
        UpscaleFailure::new(
            ERROR_UNSUPPORTED_IMAGE,
            format!("failed to decode image pixels: {error}"),
        )
    })?;
    image.apply_orientation(orientation);
    Ok(image)
}

fn write_png_atomically(
    image: &mut DynamicImage,
    output_path: &Path,
) -> Result<(), UpscaleFailure> {
    let file_name = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            UpscaleFailure::new(ERROR_CACHE_FAILED, "missing normalized output filename")
        })?;
    let temporary_path = output_path.with_file_name(format!(".{file_name}.tmp"));
    let write_result = (|| {
        let mut file = fs::File::create(&temporary_path).map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to create normalized input: {error}"),
            )
        })?;
        image
            .write_to(&mut file, image::ImageFormat::Png)
            .map_err(|error| {
                UpscaleFailure::new(
                    ERROR_UNSUPPORTED_IMAGE,
                    format!("failed to encode PNG input: {error}"),
                )
            })?;
        file.sync_all().map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to flush normalized input: {error}"),
            )
        })?;
        fs::rename(&temporary_path, output_path).map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to publish normalized input: {error}"),
            )
        })
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn source_url_to_path(source: &str) -> Result<PathBuf, UpscaleFailure> {
    let trimmed = source.trim();
    let path = if trimmed.starts_with("file://") {
        Url::parse(trimmed)
            .map_err(|error| {
                UpscaleFailure::new(
                    ERROR_INVALID_INPUT_SOURCE,
                    format!("invalid file URL: {error}"),
                )
            })?
            .to_file_path()
            .map_err(|_| {
                UpscaleFailure::new(ERROR_INVALID_INPUT_SOURCE, "file URL is not a local path")
            })?
    } else {
        if trimmed.contains("://") || trimmed.starts_with("data:") || trimmed.starts_with("asset:")
        {
            return Err(UpscaleFailure::new(
                ERROR_INVALID_INPUT_SOURCE,
                "only local project file paths are accepted",
            ));
        }
        PathBuf::from(trimmed)
    };
    if !path.is_absolute() {
        return Err(UpscaleFailure::new(
            ERROR_INVALID_INPUT_SOURCE,
            "source image path must be absolute",
        ));
    }
    Ok(path)
}

fn is_safe_project_id(project_id: &str) -> bool {
    !project_id.is_empty()
        && project_id.len() <= 128
        && project_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn is_within(path: &Path, root: &Path) -> bool {
    root.canonicalize()
        .map(|root| path.starts_with(root))
        .unwrap_or(false)
}

fn is_supported_color_type(color_type: image::ColorType) -> bool {
    matches!(
        color_type,
        image::ColorType::Rgb8
            | image::ColorType::Rgba8
            | image::ColorType::Rgb16
            | image::ColorType::Rgba16
    )
}

fn is_srgb_icc_profile(profile: &[u8]) -> bool {
    let lowercase = profile
        .iter()
        .map(u8::to_ascii_lowercase)
        .collect::<Vec<_>>();
    [
        b"srgb".as_slice(),
        b"iec61966-2.1".as_slice(),
        b"iec 61966-2.1".as_slice(),
    ]
    .iter()
    .any(|needle| {
        lowercase
            .windows(needle.len())
            .any(|window| window == *needle)
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder;

    #[test]
    fn accepts_only_safe_project_ids() {
        assert!(is_safe_project_id("project-123_abc"));
        assert!(!is_safe_project_id("../project"));
        assert!(!is_safe_project_id("project/name"));
    }

    #[test]
    fn requires_confirmed_srgb_profiles() {
        assert!(is_srgb_icc_profile(b"sRGB IEC61966-2.1"));
        assert!(!is_srgb_icc_profile(b"Display P3"));
        assert!(!is_srgb_icc_profile(b"Adobe RGB (1998)"));
    }

    #[test]
    fn applies_jpeg_exif_orientation_before_upscale() {
        let mut encoded = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut encoded)
            .write_image(
                &[255, 0, 0, 0, 0, 255],
                2,
                1,
                image::ExtendedColorType::Rgb8,
            )
            .expect("encode JPEG");
        let oriented = insert_exif_orientation(encoded, 6);

        let image = decode_srgb_image(&oriented).expect("decode oriented JPEG");
        assert_eq!((image.width(), image.height()), (1, 2));
    }

    fn insert_exif_orientation(mut jpeg: Vec<u8>, orientation: u16) -> Vec<u8> {
        let mut exif = vec![
            0xff, 0xe1, 0x00, 0x22, b'E', b'x', b'i', b'f', 0, 0, b'I', b'I', 42, 0, 8, 0, 0, 0, 1,
            0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        exif[28] = orientation as u8;
        exif[29] = (orientation >> 8) as u8;
        jpeg.splice(2..2, exif);
        jpeg
    }
}
