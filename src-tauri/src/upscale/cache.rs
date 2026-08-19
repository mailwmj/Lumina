use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::sidecar::{REAL_ESRGAN_ENGINE_VERSION, REAL_ESRGAN_MODEL_NAME};
use super::{UpscaleFailure, ERROR_CACHE_FAILED};

const UPSCALE_PREPROCESS_VERSION: &str = "srgb-orientation-png-v1";

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum CacheOutputPublication {
    Created,
    Existing,
}

pub(crate) fn ensure_upscale_cache_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS upscale_cache (
          cache_key TEXT PRIMARY KEY,
          source_sha256 TEXT NOT NULL DEFAULT '',
          engine_version TEXT NOT NULL DEFAULT '',
          scale INTEGER NOT NULL DEFAULT 2,
          output_path TEXT NOT NULL DEFAULT '',
          output_bytes INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT 0,
          last_used_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_upscale_cache_last_used_at
          ON upscale_cache(last_used_at ASC);
        "#,
    )
    .map_err(|error| format!("Failed to initialize upscale cache table: {error}"))?;

    let mut columns = HashSet::new();
    let mut statement = conn
        .prepare("PRAGMA table_info(upscale_cache)")
        .map_err(|error| format!("Failed to inspect upscale cache schema: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Failed to read upscale cache schema: {error}"))?;
    for row in rows {
        columns.insert(
            row.map_err(|error| format!("Failed to decode upscale cache column: {error}"))?,
        );
    }

    for (name, definition) in [
        ("source_sha256", "TEXT NOT NULL DEFAULT ''"),
        ("engine_version", "TEXT NOT NULL DEFAULT ''"),
        ("scale", "INTEGER NOT NULL DEFAULT 2"),
        ("output_path", "TEXT NOT NULL DEFAULT ''"),
        ("output_bytes", "INTEGER NOT NULL DEFAULT 0"),
        ("created_at", "INTEGER NOT NULL DEFAULT 0"),
        ("last_used_at", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        if !columns.contains(name) {
            conn.execute(
                &format!("ALTER TABLE upscale_cache ADD COLUMN {name} {definition}"),
                [],
            )
            .map_err(|error| format!("Failed to add upscale cache column {name}: {error}"))?;
        }
    }

    Ok(())
}

pub(super) fn resolve_cache_dir(app: &AppHandle) -> Result<PathBuf, UpscaleFailure> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        UpscaleFailure::new(
            ERROR_CACHE_FAILED,
            format!("failed to resolve app data directory: {error}"),
        )
    })?;
    let cache_dir = app_data_dir.join("upscale-cache");
    fs::create_dir_all(&cache_dir).map_err(|error| {
        UpscaleFailure::new(
            ERROR_CACHE_FAILED,
            format!("failed to create upscale cache directory: {error}"),
        )
    })?;
    Ok(cache_dir)
}

pub(super) fn build_cache_key(source_sha256: &str, scale: u8, model_sha256: &str) -> String {
    sha256_hex(
        format!(
            "{REAL_ESRGAN_ENGINE_VERSION}|{UPSCALE_PREPROCESS_VERSION}|{REAL_ESRGAN_MODEL_NAME}|{model_sha256}|{source_sha256}|{scale}"
        )
        .as_bytes(),
    )
}

pub(super) fn lookup_cache_entry(
    conn: &Connection,
    cache_dir: &Path,
    cache_key: &str,
) -> Result<Option<PathBuf>, UpscaleFailure> {
    let stored_path = conn
        .query_row(
            "SELECT output_path FROM upscale_cache WHERE cache_key = ?1",
            params![cache_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| {
            UpscaleFailure::new(ERROR_CACHE_FAILED, format!("failed to read cache: {error}"))
        })?;
    let Some(stored_path) = stored_path else {
        return Ok(None);
    };

    let expected_path = cache_dir.join(format!("{cache_key}.png"));
    if Path::new(&stored_path) != expected_path || !expected_path.is_file() {
        conn.execute(
            "DELETE FROM upscale_cache WHERE cache_key = ?1",
            params![cache_key],
        )
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to remove stale cache row: {error}"),
            )
        })?;
        return Ok(None);
    }

    conn.execute(
        "UPDATE upscale_cache SET last_used_at = ?1 WHERE cache_key = ?2",
        params![unix_timestamp_millis(), cache_key],
    )
    .map_err(|error| {
        UpscaleFailure::new(
            ERROR_CACHE_FAILED,
            format!("failed to update cache access: {error}"),
        )
    })?;
    Ok(Some(expected_path))
}

pub(super) fn publish_cache_output(
    source_path: &Path,
    cache_path: &Path,
) -> Result<CacheOutputPublication, UpscaleFailure> {
    if cache_path.is_file() {
        return Ok(CacheOutputPublication::Existing);
    }
    match copy_file_atomically(source_path, cache_path, "cache") {
        Ok(()) => Ok(CacheOutputPublication::Created),
        Err(_error) if cache_path.is_file() => Ok(CacheOutputPublication::Existing),
        Err(error) => Err(error),
    }
}

pub(super) fn record_cache_entry(
    conn: &mut Connection,
    cache_path: &Path,
    cache_key: &str,
    source_sha256: &str,
    scale: u8,
) -> Result<(), UpscaleFailure> {
    let output_bytes = fs::metadata(cache_path)
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to inspect cache output: {error}"),
            )
        })?
        .len();
    let now = unix_timestamp_millis();
    conn.execute(
        r#"
        INSERT INTO upscale_cache (
          cache_key, source_sha256, engine_version, scale, output_path, output_bytes, created_at, last_used_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(cache_key) DO UPDATE SET
          source_sha256 = excluded.source_sha256,
          engine_version = excluded.engine_version,
          scale = excluded.scale,
          output_path = excluded.output_path,
          output_bytes = excluded.output_bytes,
          last_used_at = excluded.last_used_at
        "#,
        params![
            cache_key,
            source_sha256,
            REAL_ESRGAN_ENGINE_VERSION,
            i64::from(scale),
            cache_path.to_string_lossy().to_string(),
            i64::try_from(output_bytes).unwrap_or(i64::MAX),
            now,
            now,
        ],
    )
    .map_err(|error| {
        UpscaleFailure::new(
            ERROR_CACHE_FAILED,
            format!("failed to write cache row: {error}"),
        )
    })?;
    Ok(())
}

pub(super) fn discard_cache_entry(
    conn: &Connection,
    cache_dir: &Path,
    cache_key: &str,
) -> Result<(), UpscaleFailure> {
    conn.execute(
        "DELETE FROM upscale_cache WHERE cache_key = ?1",
        params![cache_key],
    )
    .map_err(|error| {
        UpscaleFailure::new(
            ERROR_CACHE_FAILED,
            format!("failed to remove cancelled cache row: {error}"),
        )
    })?;

    let cache_path = cache_dir.join(format!("{cache_key}.png"));
    match fs::remove_file(&cache_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(UpscaleFailure::new(
            ERROR_CACHE_FAILED,
            format!("failed to remove cancelled cache output: {error}"),
        )),
    }
}

pub(super) fn prune_cache_to_limit(
    conn: &mut Connection,
    cache_dir: &Path,
    max_bytes: u64,
) -> Result<(), UpscaleFailure> {
    let mut total_bytes = conn
        .query_row(
            "SELECT COALESCE(SUM(output_bytes), 0) FROM upscale_cache",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to sum cache size: {error}"),
            )
        })?
        .max(0) as u64;
    if total_bytes <= max_bytes {
        return Ok(());
    }

    let mut statement = conn
        .prepare(
            "SELECT cache_key, output_path, output_bytes FROM upscale_cache ORDER BY last_used_at ASC, created_at ASC",
        )
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to prepare cache cleanup: {error}"),
            )
        })?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to query cache cleanup: {error}"),
            )
        })?;
    let entries = rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
        UpscaleFailure::new(
            ERROR_CACHE_FAILED,
            format!("failed to decode cache cleanup row: {error}"),
        )
    })?;
    drop(statement);

    for (cache_key, stored_path, output_bytes) in entries {
        if total_bytes <= max_bytes {
            break;
        }
        let expected_path = cache_dir.join(format!("{cache_key}.png"));
        if Path::new(&stored_path) == expected_path && expected_path.is_file() {
            fs::remove_file(&expected_path).map_err(|error| {
                UpscaleFailure::new(
                    ERROR_CACHE_FAILED,
                    format!("failed to remove old cache output: {error}"),
                )
            })?;
        }
        conn.execute(
            "DELETE FROM upscale_cache WHERE cache_key = ?1",
            params![cache_key],
        )
        .map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to remove old cache row: {error}"),
            )
        })?;
        total_bytes = total_bytes.saturating_sub(output_bytes.max(0) as u64);
    }
    Ok(())
}

pub(super) fn materialize_project_output(
    cache_path: &Path,
    output_dir: &Path,
    job_id: &str,
) -> Result<String, UpscaleFailure> {
    let output_path = output_dir.join(format!("upscale-{job_id}.png"));
    copy_file_atomically(cache_path, &output_path, "project output")?;
    Ok(output_path.to_string_lossy().to_string())
}

fn copy_file_atomically(
    source_path: &Path,
    output_path: &Path,
    label: &str,
) -> Result<(), UpscaleFailure> {
    let parent = output_path.parent().ok_or_else(|| {
        UpscaleFailure::new(
            ERROR_CACHE_FAILED,
            format!("missing {label} parent directory"),
        )
    })?;
    if !parent.is_dir() {
        return Err(UpscaleFailure::new(
            ERROR_CACHE_FAILED,
            format!("{label} parent directory is unavailable"),
        ));
    }
    let file_name = output_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            UpscaleFailure::new(ERROR_CACHE_FAILED, format!("missing {label} filename"))
        })?;
    let temporary_path = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let write_result = (|| {
        match fs::hard_link(source_path, &temporary_path) {
            Ok(()) => {}
            Err(_) => {
                fs::copy(source_path, &temporary_path).map_err(|error| {
                    UpscaleFailure::new(
                        ERROR_CACHE_FAILED,
                        format!("failed to copy {label}: {error}"),
                    )
                })?;
            }
        }
        fs::rename(&temporary_path, output_path).map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to publish {label}: {error}"),
            )
        })
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn unix_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_cleanup_evicts_oldest_entry_first() {
        let cache_dir =
            std::env::temp_dir().join(format!("lumina-upscale-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&cache_dir).expect("create cache directory");
        let mut conn = Connection::open_in_memory().expect("open test database");
        ensure_upscale_cache_schema(&conn).expect("initialize cache table");

        for (cache_key, last_used_at) in [("old", 1_i64), ("new", 2_i64)] {
            let path = cache_dir.join(format!("{cache_key}.png"));
            fs::write(&path, [1_u8; 8]).expect("write cache output");
            conn.execute(
                "INSERT INTO upscale_cache (cache_key, output_path, output_bytes, created_at, last_used_at) VALUES (?1, ?2, 8, 0, ?3)",
                params![cache_key, path.to_string_lossy().to_string(), last_used_at],
            )
            .expect("insert cache row");
        }

        prune_cache_to_limit(&mut conn, &cache_dir, 8).expect("prune cache");
        assert!(!cache_dir.join("old.png").exists());
        assert!(cache_dir.join("new.png").exists());
        let _ = fs::remove_dir_all(&cache_dir);
    }

    #[test]
    fn discarding_a_cancelled_cache_entry_removes_its_row_and_file() {
        let cache_dir =
            std::env::temp_dir().join(format!("lumina-upscale-cancel-{}", Uuid::new_v4()));
        fs::create_dir_all(&cache_dir).expect("create cache directory");
        let conn = Connection::open_in_memory().expect("open test database");
        ensure_upscale_cache_schema(&conn).expect("initialize cache table");
        let cache_key = "cancelled";
        let path = cache_dir.join(format!("{cache_key}.png"));
        fs::write(&path, [1_u8; 8]).expect("write cache output");
        conn.execute(
            "INSERT INTO upscale_cache (cache_key, output_path, output_bytes) VALUES (?1, ?2, 8)",
            params![cache_key, path.to_string_lossy().to_string()],
        )
        .expect("insert cache row");

        discard_cache_entry(&conn, &cache_dir, cache_key).expect("discard cache entry");

        let rows = conn
            .query_row(
                "SELECT COUNT(*) FROM upscale_cache WHERE cache_key = ?1",
                params![cache_key],
                |row| row.get::<_, i64>(0),
            )
            .expect("count cache entries");
        assert_eq!(rows, 0);
        assert!(!path.exists());
        let _ = fs::remove_dir_all(&cache_dir);
    }

    #[test]
    fn publishing_an_existing_cache_file_does_not_claim_ownership() {
        let cache_dir =
            std::env::temp_dir().join(format!("lumina-upscale-existing-cache-{}", Uuid::new_v4()));
        fs::create_dir_all(&cache_dir).expect("create cache directory");
        let source_path = cache_dir.join("source.png");
        let cache_path = cache_dir.join("cache.png");
        fs::write(&source_path, b"new output").expect("write source output");
        fs::write(&cache_path, b"existing output").expect("write existing cache output");

        let outcome =
            publish_cache_output(&source_path, &cache_path).expect("publish cache output");

        assert_eq!(outcome, CacheOutputPublication::Existing);
        assert_eq!(
            fs::read(&cache_path).expect("read cache output"),
            b"existing output"
        );
        let _ = fs::remove_dir_all(&cache_dir);
    }
}
