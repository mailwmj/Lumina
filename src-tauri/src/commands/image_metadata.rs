use std::path::PathBuf;

use serde::Serialize;

use super::image::{decode_asset_url_path, decode_file_url_path};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDimensions {
    width: u32,
    height: u32,
}

fn probe_local_image(source: &str) -> Result<Option<ImageDimensions>, String> {
    let source = source.trim();
    // Metadata must never trigger a remote download or a WebView image decode.
    if source.is_empty()
        || source.starts_with("http://")
        || source.starts_with("https://")
        || source.starts_with("data:")
        || source.starts_with("blob:")
    {
        return Ok(None);
    }
    let path = if source.starts_with("file://") {
        PathBuf::from(decode_file_url_path(source))
    } else if source.starts_with("asset://") {
        decode_asset_url_path(source)?
    } else {
        PathBuf::from(source)
    };
    let (width, height) = image::ImageReader::open(path)
        .map_err(|error| format!("Unable to open image metadata: {error}"))?
        .with_guessed_format()
        .map_err(|error| format!("Unable to identify image format: {error}"))?
        .into_dimensions()
        .map_err(|error| format!("Unable to read image dimensions: {error}"))?;
    Ok(Some(ImageDimensions { width, height }))
}

#[tauri::command]
pub async fn read_image_dimensions(source: String) -> Result<Option<ImageDimensions>, String> {
    tauri::async_runtime::spawn_blocking(move || probe_local_image(&source))
        .await
        .map_err(|error| format!("Image metadata task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_dimensions_from_a_large_file_without_decoding_pixels() {
        let path =
            std::env::temp_dir().join(format!("lumina-metadata-{}.png", uuid::Uuid::new_v4()));
        // Only the PNG header and first IDAT chunk header are present. Pixel
        // decoding would fail; dimensions must remain readable from the header.
        let mut png = Vec::new();
        {
            let encoder = png::Encoder::new(&mut png, 4096, 3072);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&vec![0; 4096 * 3072]).unwrap();
        }
        let idat = png.windows(4).position(|bytes| bytes == b"IDAT").unwrap();
        png.truncate(idat + 4);
        std::fs::write(&path, png).unwrap();
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(30 * 1024 * 1024)
            .unwrap();
        let expected = Some(ImageDimensions {
            width: 4096,
            height: 3072,
        });
        assert_eq!(probe_local_image(path.to_str().unwrap()).unwrap(), expected);
        let url = url::Url::from_file_path(&path).unwrap().to_string();
        assert_eq!(probe_local_image(&url).unwrap(), expected);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn missing_files_fail_and_nonlocal_sources_do_not_start_downloads() {
        let missing = std::env::temp_dir().join(format!("lumina-missing-{}", uuid::Uuid::new_v4()));
        assert!(probe_local_image(missing.to_str().unwrap()).is_err());
        assert_eq!(
            probe_local_image("https://example.com/large.png").unwrap(),
            None
        );
        assert_eq!(
            probe_local_image("data:image/png;base64,large").unwrap(),
            None
        );
    }
}
