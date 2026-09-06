use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    metadata::Orientation, DynamicImage, GenericImageView, ImageDecoder, ImageFormat, ImageReader,
};
use reqwest::header::CONTENT_TYPE;
use reqwest::Client;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use crate::ai::error::AIError;

pub(crate) struct ReferenceImage {
    pub(crate) bytes: Vec<u8>,
    pub(crate) mime_type: String,
    pub(crate) extension: &'static str,
}

const OPENAI_REFERENCE_MAX_LONG_EDGE: u32 = 4_096;
const OPENAI_REFERENCE_MAX_PIXELS: u64 = 16_000_000;
const OPENAI_REFERENCE_JPEG_QUALITIES: [u8; 5] = [95, 90, 85, 80, 75];

#[derive(Clone, Copy)]
struct ReferenceImageLimits {
    max_long_edge: u32,
    max_pixels: u64,
    max_bytes: usize,
}

pub(crate) struct NormalizedReferenceImage {
    pub(crate) image: ReferenceImage,
    pub(crate) original_dimensions: (u32, u32),
    pub(crate) transmitted_dimensions: (u32, u32),
}

fn image_mime_type_from_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }

    None
}

fn image_mime_type_from_path(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("png") => Some("image/png"),
        Some("webp") => Some("image/webp"),
        Some("gif") => Some("image/gif"),
        _ => None,
    }
}

fn normalize_image_mime_type(
    bytes: &[u8],
    declared_mime_type: Option<&str>,
    path: Option<&Path>,
) -> String {
    image_mime_type_from_bytes(bytes)
        .or_else(|| {
            declared_mime_type
                .and_then(|value| value.split(';').next())
                .map(str::trim)
                .filter(|value| value.starts_with("image/"))
        })
        .or_else(|| path.and_then(image_mime_type_from_path))
        .unwrap_or("image/png")
        .to_string()
}

fn image_extension(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    }
}

pub(crate) fn reference_image(
    bytes: Vec<u8>,
    declared_mime_type: Option<&str>,
    path: Option<&Path>,
) -> ReferenceImage {
    let mime_type = normalize_image_mime_type(&bytes, declared_mime_type, path);
    let extension = image_extension(&mime_type);
    ReferenceImage {
        bytes,
        mime_type,
        extension,
    }
}

fn decode_data_url(source: &str) -> Option<Result<(Vec<u8>, String), AIError>> {
    let (meta, payload) = source.split_once(',')?;
    if !meta.starts_with("data:") || !meta.ends_with(";base64") {
        return None;
    }

    let mime_type = meta
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .filter(|value| !value.is_empty())
        .unwrap_or("image/png")
        .to_string();
    Some(
        STANDARD
            .decode(payload)
            .map(|bytes| (bytes, mime_type))
            .map_err(|error| {
                AIError::InvalidRequest(format!("Invalid reference image data URL: {}", error))
            }),
    )
}

pub(crate) async fn load_reference_image(
    client: &Client,
    source: &str,
) -> Result<ReferenceImage, AIError> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err(AIError::InvalidRequest(
            "Reference image source cannot be empty".to_string(),
        ));
    }

    if let Some(decoded) = decode_data_url(trimmed) {
        let (bytes, mime_type) = decoded?;
        return Ok(reference_image(bytes, Some(&mime_type), None));
    }

    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        let response = client.get(trimmed).send().await?;
        let status = response.status();
        if !status.is_success() {
            let details = response.text().await.unwrap_or_default();
            return Err(AIError::Provider(format!(
                "Failed to download reference image {}: {} {}",
                trimmed, status, details
            )));
        }
        let declared_mime_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let bytes = response.bytes().await?.to_vec();
        return Ok(reference_image(bytes, declared_mime_type.as_deref(), None));
    }

    let likely_base64 = trimmed.len() > 256
        && trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || character == '+'
                || character == '/'
                || character == '='
        });
    if likely_base64 {
        let bytes = STANDARD.decode(trimmed).map_err(|error| {
            AIError::InvalidRequest(format!("Invalid reference image base64: {}", error))
        })?;
        return Ok(reference_image(bytes, None, None));
    }

    if trimmed.starts_with("asset://")
        || trimmed.starts_with("tauri://")
        || trimmed.starts_with("app://")
    {
        return Err(AIError::InvalidRequest(format!(
            "Unsupported reference image source: {}",
            trimmed
        )));
    }

    let raw_path = trimmed.trim_start_matches("file://");
    let decoded_path = urlencoding::decode(raw_path)
        .map(|value| value.into_owned())
        .unwrap_or_else(|_| raw_path.to_string());
    let path = PathBuf::from(decoded_path);
    let bytes = std::fs::read(&path).map_err(|error| {
        AIError::InvalidRequest(format!(
            "Unable to read reference image '{}': {}",
            path.to_string_lossy(),
            error
        ))
    })?;
    Ok(reference_image(bytes, None, Some(&path)))
}

pub(crate) fn normalize_openai_reference_image(
    image: ReferenceImage,
    max_bytes: usize,
) -> Result<NormalizedReferenceImage, AIError> {
    normalize_reference_image(
        image,
        ReferenceImageLimits {
            max_long_edge: OPENAI_REFERENCE_MAX_LONG_EDGE,
            max_pixels: OPENAI_REFERENCE_MAX_PIXELS,
            max_bytes,
        },
    )
}

fn normalize_reference_image(
    image: ReferenceImage,
    limits: ReferenceImageLimits,
) -> Result<NormalizedReferenceImage, AIError> {
    if limits.max_long_edge == 0 || limits.max_pixels == 0 || limits.max_bytes == 0 {
        return Err(AIError::InvalidRequest(
            "Reference image normalization limits must be greater than zero".to_string(),
        ));
    }

    let reader = ImageReader::new(Cursor::new(image.bytes.as_slice()))
        .with_guessed_format()
        .map_err(|error| {
            AIError::InvalidRequest(format!(
                "Unable to identify reference image format: {error}"
            ))
        })?;
    reader.format().ok_or_else(|| {
        AIError::InvalidRequest("Unable to identify reference image format".to_string())
    })?;
    let mut decoder = reader.into_decoder().map_err(|error| {
        AIError::InvalidRequest(format!("Unable to decode reference image: {error}"))
    })?;
    let original_dimensions = decoder.dimensions();
    let target_dimensions = bounded_dimensions(original_dimensions, limits);

    if target_dimensions == original_dimensions && image.bytes.len() <= limits.max_bytes {
        drop(decoder);
        return Ok(NormalizedReferenceImage {
            image,
            original_dimensions,
            transmitted_dimensions: original_dimensions,
        });
    }

    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut decoded = DynamicImage::from_decoder(decoder).map_err(|error| {
        AIError::InvalidRequest(format!("Unable to decode reference image: {error}"))
    })?;
    decoded.apply_orientation(orientation);
    let oriented_dimensions = decoded.dimensions();
    let target_dimensions = bounded_dimensions(oriented_dimensions, limits);
    let (output_format, mime_type, extension) =
        normalized_output_format(decoded.color().has_alpha());
    let mut transmitted_dimensions = target_dimensions;
    let mut bytes = encode_normalized_image_at_dimensions(
        &decoded,
        transmitted_dimensions,
        output_format,
        limits.max_bytes,
    )?;
    for _ in 0..8 {
        if bytes.len() <= limits.max_bytes || transmitted_dimensions == (1, 1) {
            break;
        }
        let scale = ((limits.max_bytes as f64 / bytes.len() as f64).sqrt() * 0.96).clamp(0.1, 0.95);
        let next_dimensions = (
            (f64::from(transmitted_dimensions.0) * scale)
                .floor()
                .max(1.0) as u32,
            (f64::from(transmitted_dimensions.1) * scale)
                .floor()
                .max(1.0) as u32,
        );
        if next_dimensions == transmitted_dimensions {
            break;
        }
        transmitted_dimensions = next_dimensions;
        bytes = encode_normalized_image_at_dimensions(
            &decoded,
            transmitted_dimensions,
            output_format,
            limits.max_bytes,
        )?;
    }
    if bytes.len() > limits.max_bytes {
        return Err(AIError::InvalidRequest(format!(
            "Unable to reduce reference image below {} bytes",
            limits.max_bytes
        )));
    }
    drop(decoded);

    let validated =
        image::load_from_memory_with_format(&bytes, output_format).map_err(|error| {
            AIError::InvalidRequest(format!(
                "Unable to validate normalized reference image: {error}"
            ))
        })?;
    let validated_dimensions = validated.dimensions();
    if validated_dimensions != transmitted_dimensions {
        return Err(AIError::InvalidRequest(format!(
            "Normalized reference image dimensions changed unexpectedly: expected {}x{}, got {}x{}",
            transmitted_dimensions.0,
            transmitted_dimensions.1,
            validated_dimensions.0,
            validated_dimensions.1
        )));
    }

    Ok(NormalizedReferenceImage {
        image: ReferenceImage {
            bytes,
            mime_type: mime_type.to_string(),
            extension,
        },
        original_dimensions,
        transmitted_dimensions,
    })
}

fn bounded_dimensions((width, height): (u32, u32), limits: ReferenceImageLimits) -> (u32, u32) {
    let long_edge = width.max(height);
    let pixels = u64::from(width) * u64::from(height);
    if long_edge <= limits.max_long_edge && pixels <= limits.max_pixels {
        return (width, height);
    }

    let edge_scale = f64::from(limits.max_long_edge) / f64::from(long_edge);
    let pixel_scale = (limits.max_pixels as f64 / pixels as f64).sqrt();
    let scale = edge_scale.min(pixel_scale).min(1.0);
    let mut target_width = (f64::from(width) * scale).floor().max(1.0) as u32;
    let mut target_height = (f64::from(height) * scale).floor().max(1.0) as u32;
    let target_pixels = u64::from(target_width) * u64::from(target_height);
    if target_pixels > limits.max_pixels {
        if target_width >= target_height {
            target_width = (limits.max_pixels / u64::from(target_height)).max(1) as u32;
        } else {
            target_height = (limits.max_pixels / u64::from(target_width)).max(1) as u32;
        }
    }

    (target_width, target_height)
}

fn normalized_output_format(has_alpha: bool) -> (ImageFormat, &'static str, &'static str) {
    if has_alpha {
        (ImageFormat::Png, "image/png", "png")
    } else {
        (ImageFormat::Jpeg, "image/jpeg", "jpg")
    }
}

fn encode_normalized_image(
    image: &DynamicImage,
    format: ImageFormat,
    jpeg_quality: u8,
) -> Result<Vec<u8>, AIError> {
    let mut output = Cursor::new(Vec::new());
    if format == ImageFormat::Jpeg {
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, jpeg_quality);
        image.write_with_encoder(encoder)?;
    } else {
        image.write_to(&mut output, format)?;
    }
    Ok(output.into_inner())
}

fn encode_normalized_image_at_dimensions(
    image: &DynamicImage,
    dimensions: (u32, u32),
    format: ImageFormat,
    max_bytes: usize,
) -> Result<Vec<u8>, AIError> {
    let encode = |candidate: &DynamicImage| -> Result<Vec<u8>, AIError> {
        if format != ImageFormat::Jpeg {
            return encode_normalized_image(candidate, format, u8::MAX);
        }

        let mut smallest = Vec::new();
        for quality in OPENAI_REFERENCE_JPEG_QUALITIES {
            let bytes = encode_normalized_image(candidate, format, quality)?;
            if bytes.len() <= max_bytes {
                return Ok(bytes);
            }
            smallest = bytes;
        }
        Ok(smallest)
    };

    if image.dimensions() == dimensions {
        return encode(image);
    }

    let resized = image.resize_exact(
        dimensions.0,
        dimensions.1,
        image::imageops::FilterType::Lanczos3,
    );
    encode(&resized)
}

#[cfg(test)]
mod tests {
    use super::{
        bounded_dimensions, normalize_reference_image, reference_image, ReferenceImageLimits,
        OPENAI_REFERENCE_MAX_LONG_EDGE, OPENAI_REFERENCE_MAX_PIXELS,
    };
    use image::{
        codecs::jpeg::JpegEncoder, DynamicImage, GenericImageView, ImageFormat, Rgb, RgbImage,
        Rgba, RgbaImage,
    };
    use std::io::Cursor;

    fn png_bytes(width: u32, height: u32, alpha: u8) -> Vec<u8> {
        let pixels = RgbaImage::from_pixel(width, height, Rgba([24, 96, 180, alpha]));
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(pixels)
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }

    fn opaque_png_bytes(width: u32, height: u32) -> Vec<u8> {
        let pixels = RgbImage::from_pixel(width, height, Rgb([24, 96, 180]));
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(pixels)
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }

    fn noisy_jpeg_bytes(width: u32, height: u32, quality: u8) -> Vec<u8> {
        let pixels = RgbImage::from_fn(width, height, |x, y| {
            let value = x
                .wrapping_mul(1_664_525)
                .wrapping_add(y.wrapping_mul(1_013_904_223));
            Rgb([
                value as u8,
                value.rotate_left(9) as u8,
                value.rotate_left(17) as u8,
            ])
        });
        let mut output = Vec::new();
        DynamicImage::ImageRgb8(pixels)
            .write_with_encoder(JpegEncoder::new_with_quality(&mut output, quality))
            .unwrap();
        output
    }

    #[test]
    fn oversized_reference_image_is_proportionally_bounded_and_decodable() {
        let input = reference_image(png_bytes(120, 80, 96), Some("image/png"), None);
        let normalized = normalize_reference_image(
            input,
            ReferenceImageLimits {
                max_long_edge: 100,
                max_pixels: 2_400,
                max_bytes: usize::MAX,
            },
        )
        .unwrap();

        assert_eq!(normalized.original_dimensions, (120, 80));
        assert_eq!(normalized.transmitted_dimensions, (60, 40));
        assert_eq!(normalized.image.mime_type, "image/png");
        assert_eq!(normalized.image.extension, "png");

        let decoded = image::load_from_memory(&normalized.image.bytes).unwrap();
        assert_eq!(decoded.dimensions(), (60, 40));
        assert!(decoded.color().has_alpha());
        assert!(decoded.get_pixel(30, 20).0[3] < u8::MAX);
    }

    #[test]
    fn reference_image_dimensions_use_the_most_restrictive_limit() {
        let edge_limited = normalize_reference_image(
            reference_image(png_bytes(120, 80, u8::MAX), Some("image/png"), None),
            ReferenceImageLimits {
                max_long_edge: 60,
                max_pixels: 10_000,
                max_bytes: usize::MAX,
            },
        )
        .unwrap();
        let pixel_limited = normalize_reference_image(
            reference_image(png_bytes(120, 80, u8::MAX), Some("image/png"), None),
            ReferenceImageLimits {
                max_long_edge: 100,
                max_pixels: 2_400,
                max_bytes: usize::MAX,
            },
        )
        .unwrap();

        assert_eq!(edge_limited.transmitted_dimensions, (60, 40));
        assert_eq!(pixel_limited.transmitted_dimensions, (60, 40));
        assert_eq!(
            bounded_dimensions(
                (5_464, 8_192),
                ReferenceImageLimits {
                    max_long_edge: OPENAI_REFERENCE_MAX_LONG_EDGE,
                    max_pixels: OPENAI_REFERENCE_MAX_PIXELS,
                    max_bytes: usize::MAX,
                },
            ),
            (2_732, 4_096)
        );
    }

    #[test]
    fn under_limit_reference_image_keeps_original_bytes_and_metadata() {
        let bytes = png_bytes(32, 24, 160);
        let normalized = normalize_reference_image(
            reference_image(bytes.clone(), Some("image/png"), None),
            ReferenceImageLimits {
                max_long_edge: 64,
                max_pixels: 4_096,
                max_bytes: usize::MAX,
            },
        )
        .unwrap();

        assert_eq!(normalized.original_dimensions, (32, 24));
        assert_eq!(normalized.transmitted_dimensions, (32, 24));
        assert_eq!(normalized.image.bytes, bytes);
        assert_eq!(normalized.image.mime_type, "image/png");
        assert_eq!(normalized.image.extension, "png");
    }

    #[test]
    fn transformed_opaque_png_uses_jpeg_to_preserve_more_pixels() {
        let normalized = normalize_reference_image(
            reference_image(opaque_png_bytes(64, 48), Some("image/png"), None),
            ReferenceImageLimits {
                max_long_edge: 32,
                max_pixels: 1_024,
                max_bytes: usize::MAX,
            },
        )
        .unwrap();

        assert_eq!(normalized.transmitted_dimensions, (32, 24));
        assert_eq!(normalized.image.mime_type, "image/jpeg");
        assert_eq!(normalized.image.extension, "jpg");
        assert!(normalized.image.bytes.starts_with(&[0xff, 0xd8, 0xff]));
    }

    #[test]
    fn byte_heavy_reference_is_reencoded_even_when_dimensions_are_within_limits() {
        let bytes = png_bytes(64, 64, 160);
        let max_bytes = bytes.len().saturating_sub(1);
        let normalized = normalize_reference_image(
            reference_image(bytes.clone(), Some("image/png"), None),
            ReferenceImageLimits {
                max_long_edge: 128,
                max_pixels: 16_384,
                max_bytes,
            },
        )
        .unwrap();

        assert_ne!(normalized.image.bytes, bytes);
        assert!(normalized.image.bytes.len() <= max_bytes);
        assert!(normalized.transmitted_dimensions.0 <= 64);
        assert!(normalized.transmitted_dimensions.1 <= 64);
        assert!(image::load_from_memory(&normalized.image.bytes).is_ok());
    }

    #[test]
    fn jpeg_quality_is_reduced_before_dimensions() {
        let bytes = noisy_jpeg_bytes(256, 256, 100);
        let normalized = normalize_reference_image(
            reference_image(bytes.clone(), Some("image/jpeg"), None),
            ReferenceImageLimits {
                max_long_edge: 256,
                max_pixels: 65_536,
                max_bytes: bytes.len() / 2,
            },
        )
        .unwrap();

        assert_eq!(normalized.transmitted_dimensions, (256, 256));
        assert!(normalized.image.bytes.len() <= bytes.len() / 2);
        assert_eq!(normalized.image.mime_type, "image/jpeg");
        assert!(image::load_from_memory(&normalized.image.bytes).is_ok());
    }
}
