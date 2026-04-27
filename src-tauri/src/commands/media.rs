use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

fn decode_file_url_path(url: &str) -> String {
    let raw = url.strip_prefix("file://").unwrap_or(url);
    let decoded = urlencoding::decode(raw).unwrap_or_else(|_| raw.into());
    decoded.trim_start_matches('/').to_string()
}

fn resolve_source_path(source_path: &str) -> PathBuf {
    if source_path.starts_with("file://") {
        return PathBuf::from(decode_file_url_path(source_path));
    }
    PathBuf::from(source_path)
}

fn ensure_file_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Source file not found: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("Source is not a file: {}", path.display()));
    }
    Ok(())
}

fn resolve_project_upload_dir(app: &AppHandle, project_id: &str, kind: &str) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let dir = app_data_dir.join("projects").join(project_id).join("uploads").join(kind);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create media upload dir {}: {}", dir.display(), e))?;
    Ok(dir)
}

fn build_output_filename(source: &Path, ext: &str) -> String {
    let stem = source
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("media")
        .replace(' ', "_");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}_{}.{}", now, stem, ext)
}

fn run_ffmpeg_convert(source: &Path, target: &Path, args: &[&str]) -> Result<(), String> {
    let mut command = Command::new("ffmpeg");
    command.arg("-y").arg("-i").arg(source);
    for arg in args {
        command.arg(arg);
    }
    command.arg(target);

    let output = command
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}. Please install ffmpeg and ensure it's in PATH.", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg convert failed: {}", stderr));
    }
    Ok(())
}

#[tauri::command]
pub fn convert_video_to_mp4(
    app: AppHandle,
    source_path: String,
    project_id: String,
) -> Result<String, String> {
    let source = resolve_source_path(&source_path);
    ensure_file_exists(&source)?;

    let output_dir = resolve_project_upload_dir(&app, &project_id, "videos")?;
    let output_path = output_dir.join(build_output_filename(&source, "mp4"));

    let is_mp4 = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false);

    if is_mp4 {
        std::fs::copy(&source, &output_path)
            .map_err(|e| format!("Failed to copy mp4 file: {}", e))?;
    } else {
        run_ffmpeg_convert(
            &source,
            &output_path,
            &[
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
            ],
        )?;
    }

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn convert_audio_to_mp3(
    app: AppHandle,
    source_path: String,
    project_id: String,
) -> Result<String, String> {
    let source = resolve_source_path(&source_path);
    ensure_file_exists(&source)?;

    let output_dir = resolve_project_upload_dir(&app, &project_id, "audios")?;
    let output_path = output_dir.join(build_output_filename(&source, "mp3"));

    let is_mp3 = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("mp3"))
        .unwrap_or(false);

    if is_mp3 {
        std::fs::copy(&source, &output_path)
            .map_err(|e| format!("Failed to copy mp3 file: {}", e))?;
    } else {
        run_ffmpeg_convert(
            &source,
            &output_path,
            &["-vn", "-codec:a", "libmp3lame", "-b:a", "192k"],
        )?;
    }

    Ok(output_path.to_string_lossy().to_string())
}
