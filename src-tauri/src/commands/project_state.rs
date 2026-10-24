use std::path::PathBuf;
use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummaryRecord {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub node_count: i64,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub node_count: i64,
    pub thumbnail_url: Option<String>,
    pub nodes_json: String,
    pub edges_json: String,
    pub viewport_json: String,
    pub history_json: String,
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    Ok(app_data_dir.join("projects.db"))
}

pub(crate) fn ensure_projects_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          node_count INTEGER NOT NULL DEFAULT 0,
          nodes_json TEXT NOT NULL,
          edges_json TEXT NOT NULL,
          viewport_json TEXT NOT NULL,
          history_json TEXT NOT NULL,
          thumbnail_url TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
        CREATE TABLE IF NOT EXISTS project_image_refs (
          project_id TEXT NOT NULL,
          path TEXT NOT NULL,
          PRIMARY KEY(project_id, path)
        );
        CREATE INDEX IF NOT EXISTS idx_project_image_refs_path ON project_image_refs(path);
        "#,
    )
    .map_err(|e| format!("Failed to initialize projects table: {}", e))?;

    let mut has_node_count = false;
    let mut has_thumbnail_url = false;
    let mut stmt = conn
        .prepare("PRAGMA table_info(projects)")
        .map_err(|e| format!("Failed to inspect projects schema: {}", e))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to inspect projects columns: {}", e))?;

    for name_result in rows {
        let column_name =
            name_result.map_err(|e| format!("Failed to read projects column name: {}", e))?;
        if column_name == "node_count" {
            has_node_count = true;
        }
        if column_name == "thumbnail_url" {
            has_thumbnail_url = true;
        }
    }

    if !has_node_count {
        conn.execute(
            "ALTER TABLE projects ADD COLUMN node_count INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| format!("Failed to add node_count column: {}", e))?;
    }

    if !has_thumbnail_url {
        conn.execute("ALTER TABLE projects ADD COLUMN thumbnail_url TEXT", [])
            .map_err(|e| format!("Failed to add thumbnail_url column: {}", e))?;
    }

    super::agent_threads::ensure_agent_tables(conn)?;
    Ok(())
}

// Writes used to be serialized by running on the main thread; keep that guarantee
// now that they run on the blocking pool, so a prune never races another upsert.
static PROJECT_WRITE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn lock_project_writes() -> MutexGuard<'static, ()> {
    PROJECT_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) async fn run_blocking<T, F>(task_name: &str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("{task_name} task failed: {error}"))?
}

fn parse_image_pool(parsed: &serde_json::Value) -> Vec<String> {
    parsed
        .get("imagePool")
        .and_then(|value| value.as_array())
        .map(|array| {
            array
                .iter()
                .filter_map(|value| value.as_str().map(|item| item.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn resolve_image_ref(value: &str, image_pool: &[String]) -> Option<String> {
    const IMAGE_REF_PREFIX: &str = "__img_ref__:";

    if let Some(index_text) = value.strip_prefix(IMAGE_REF_PREFIX) {
        let index = index_text.parse::<usize>().ok()?;
        return image_pool.get(index).cloned();
    }

    if value.trim().is_empty() {
        return None;
    }

    Some(value.to_string())
}

fn collect_image_paths_from_nodes(
    nodes: &[serde_json::Value],
    image_pool: &[String],
    paths: &mut HashSet<String>,
) {
    for node in nodes {
        let data = match node.get("data").and_then(|value| value.as_object()) {
            Some(value) => value,
            None => continue,
        };

        for key in ["imageUrl", "previewImageUrl", "referenceImageUrl"] {
            if let Some(raw_value) = data.get(key).and_then(|value| value.as_str()) {
                if let Some(path) = resolve_image_ref(raw_value, image_pool) {
                    paths.insert(path);
                }
            }
        }

        if let Some(frames) = data.get("frames").and_then(|value| value.as_array()) {
            for frame in frames {
                let frame_obj = match frame.as_object() {
                    Some(value) => value,
                    None => continue,
                };
                for key in ["imageUrl", "previewImageUrl", "referenceImageUrl"] {
                    if let Some(raw_value) = frame_obj.get(key).and_then(|value| value.as_str()) {
                        if let Some(path) = resolve_image_ref(raw_value, image_pool) {
                            paths.insert(path);
                        }
                    }
                }
            }
        }
    }
}

fn extract_project_image_paths(nodes_json: &str, history_json: &str) -> HashSet<String> {
    let parsed_history = serde_json::from_str::<serde_json::Value>(history_json).ok();
    let image_pool = parsed_history
        .as_ref()
        .map(parse_image_pool)
        .unwrap_or_default();
    let mut paths = HashSet::new();

    if let Ok(parsed_nodes) = serde_json::from_str::<serde_json::Value>(nodes_json) {
        if let Some(nodes) = parsed_nodes.as_array() {
            collect_image_paths_from_nodes(nodes, &image_pool, &mut paths);
        }
    }

    if let Some(parsed_history) = parsed_history {
        for timeline_key in ["past", "future"] {
            let Some(timeline) = parsed_history.get(timeline_key).and_then(|value| value.as_array()) else {
                continue;
            };

            for snapshot in timeline {
                let Some(nodes) = snapshot.get("nodes").and_then(|value| value.as_array()) else {
                    continue;
                };
                collect_image_paths_from_nodes(nodes, &image_pool, &mut paths);
            }
        }
    }

    paths
}

fn resolve_images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let images_dir = app_data_dir.join("images");
    std::fs::create_dir_all(&images_dir)
        .map_err(|e| format!("Failed to create images dir: {}", e))?;
    Ok(images_dir)
}

fn load_project_image_refs(conn: &Connection, project_id: &str) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("SELECT path FROM project_image_refs WHERE project_id = ?1")
        .map_err(|e| format!("Failed to prepare project image refs query: {}", e))?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query project image refs: {}", e))?;

    let mut paths = HashSet::new();
    for path_result in rows {
        paths.insert(path_result.map_err(|e| format!("Failed to decode image ref row: {}", e))?);
    }
    Ok(paths)
}

fn prune_unreferenced_images(app: &AppHandle, conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT DISTINCT path FROM project_image_refs")
        .map_err(|e| format!("Failed to prepare image refs query: {}", e))?;

    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query image refs: {}", e))?;

    let mut referenced = HashSet::new();
    for path_result in rows {
        let path = path_result.map_err(|e| format!("Failed to decode image ref row: {}", e))?;
        referenced.insert(path);
    }

    let images_dir = resolve_images_dir(app)?;
    let entries = std::fs::read_dir(&images_dir)
        .map_err(|e| format!("Failed to read images dir: {}", e))?;

    for entry_result in entries {
        let entry = entry_result.map_err(|e| format!("Failed to iterate images dir: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let path_string = path.to_string_lossy().to_string();
        if !referenced.contains(&path_string) {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete unreferenced image: {}", e))?;
        }
    }

    Ok(())
}

pub(crate) fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = resolve_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open SQLite DB: {}", e))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to set journal_mode=WAL: {}", e))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("Failed to set synchronous=NORMAL: {}", e))?;
    conn.pragma_update(None, "temp_store", "MEMORY")
        .map_err(|e| format!("Failed to set temp_store=MEMORY: {}", e))?;
    conn.busy_timeout(Duration::from_millis(3000))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    ensure_projects_table(&conn)?;
    Ok(conn)
}

#[tauri::command]
pub async fn list_project_summaries(app: AppHandle) -> Result<Vec<ProjectSummaryRecord>, String> {
    run_blocking("List project summaries", move || list_project_summaries_sync(&app)).await
}

fn list_project_summaries_sync(app: &AppHandle) -> Result<Vec<ProjectSummaryRecord>, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              id,
              name,
              created_at,
              updated_at,
              node_count,
              thumbnail_url
            FROM projects
            ORDER BY updated_at DESC
            "#,
        )
        .map_err(|e| format!("Failed to prepare list summaries query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectSummaryRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                node_count: row.get(4)?,
                thumbnail_url: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query project summaries: {}", e))?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| format!("Failed to decode summary row: {}", e))?);
    }
    Ok(projects)
}

#[tauri::command]
pub async fn get_project_record(
    app: AppHandle,
    project_id: String,
) -> Result<Option<ProjectRecord>, String> {
    run_blocking("Get project record", move || get_project_record_sync(&app, project_id)).await
}

fn get_project_record_sync(app: &AppHandle, project_id: String) -> Result<Option<ProjectRecord>, String> {
    let conn = open_db(app)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              id,
              name,
              created_at,
              updated_at,
              node_count,
              nodes_json,
              edges_json,
              viewport_json,
              history_json,
              thumbnail_url
            FROM projects
            WHERE id = ?1
            LIMIT 1
            "#,
        )
        .map_err(|e| format!("Failed to prepare get project query: {}", e))?;

    let result = stmt.query_row(params![project_id], |row| {
        Ok(ProjectRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            node_count: row.get(4)?,
            nodes_json: row.get(5)?,
            edges_json: row.get(6)?,
            viewport_json: row.get(7)?,
            history_json: row.get(8)?,
            thumbnail_url: row.get(9)?,
        })
    });

    match result {
        Ok(record) => Ok(Some(record)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("Failed to load project: {}", error)),
    }
}

#[tauri::command]
pub async fn upsert_project_record(app: AppHandle, record: ProjectRecord) -> Result<(), String> {
    run_blocking("Upsert project record", move || upsert_project_record_sync(&app, record)).await
}

fn upsert_project_record_sync(app: &AppHandle, record: ProjectRecord) -> Result<(), String> {
    let image_paths = extract_project_image_paths(&record.nodes_json, &record.history_json);
    let _write_guard = lock_project_writes();
    let mut conn = open_db(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    tx.execute(
        r#"
        INSERT INTO projects (
          id,
          name,
          created_at,
          updated_at,
          node_count,
          nodes_json,
          edges_json,
          viewport_json,
          history_json,
          thumbnail_url
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          node_count = excluded.node_count,
          nodes_json = excluded.nodes_json,
          edges_json = excluded.edges_json,
          viewport_json = excluded.viewport_json,
          history_json = excluded.history_json,
          thumbnail_url = excluded.thumbnail_url
        "#,
        params![
            record.id,
            record.name,
            record.created_at,
            record.updated_at,
            record.node_count,
            record.nodes_json,
            record.edges_json,
            record.viewport_json,
            record.history_json,
            record.thumbnail_url,
        ],
    )
    .map_err(|e| format!("Failed to upsert project: {}", e))?;

    // Most saves only move nodes or edit text; skip the ref rewrite and the
    // images-dir scan unless this project's image set actually changed.
    let image_refs_changed = load_project_image_refs(&tx, &record.id)? != image_paths;
    if image_refs_changed {
        tx.execute(
            "DELETE FROM project_image_refs WHERE project_id = ?1",
            params![record.id],
        )
        .map_err(|e| format!("Failed to clear project image refs: {}", e))?;

        for path in image_paths {
            tx.execute(
                "INSERT OR IGNORE INTO project_image_refs (project_id, path) VALUES (?1, ?2)",
                params![record.id, path],
            )
            .map_err(|e| format!("Failed to upsert project image ref: {}", e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit upsert transaction: {}", e))?;

    if image_refs_changed {
        prune_unreferenced_images(app, &conn)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn create_project_dirs(app: AppHandle, project_id: String, project_name: String) -> Result<(), String> {
    run_blocking("Create project dirs", move || {
        create_project_dirs_sync(&app, project_id, project_name)
    })
    .await
}

fn create_project_dirs_sync(app: &AppHandle, project_id: String, project_name: String) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let project_base = app_data_dir.join("projects").join(&project_id);
    for subdir in &["uploads", "outputs/images", "outputs/videos"] {
        let dir = project_base.join(subdir);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create directory {}: {}", dir.display(), e))?;
    }
    // Write a metadata file so users can identify which UUID folder corresponds to which project
    let meta = serde_json::json!({
        "id": project_id,
        "name": project_name,
    });
    let meta_path = project_base.join("_project.json");
    std::fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap_or_default())
        .map_err(|e| format!("Failed to write project metadata: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn update_project_viewport_record(
    app: AppHandle,
    project_id: String,
    viewport_json: String,
) -> Result<(), String> {
    run_blocking("Update project viewport", move || {
        update_project_viewport_record_sync(&app, project_id, viewport_json)
    })
    .await
}

fn update_project_viewport_record_sync(
    app: &AppHandle,
    project_id: String,
    viewport_json: String,
) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE projects SET viewport_json = ?1 WHERE id = ?2",
        params![viewport_json, project_id],
    )
    .map_err(|e| format!("Failed to update project viewport: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn rename_project_record(
    app: AppHandle,
    project_id: String,
    name: String,
    updated_at: i64,
) -> Result<(), String> {
    run_blocking("Rename project", move || {
        rename_project_record_sync(&app, project_id, name, updated_at)
    })
    .await
}

fn rename_project_record_sync(
    app: &AppHandle,
    project_id: String,
    name: String,
    updated_at: i64,
) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, updated_at, project_id],
    )
    .map_err(|e| format!("Failed to rename project: {}", e))?;

    // Sync project metadata file on disk
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let meta_path = app_data_dir.join("projects").join(&project_id).join("_project.json");
    if meta_path.exists() {
        let meta = serde_json::json!({
            "id": project_id,
            "name": name,
        });
        let _ = std::fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap_or_default());
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_project_record(app: AppHandle, project_id: String) -> Result<(), String> {
    run_blocking("Delete project", move || delete_project_record_sync(&app, project_id)).await
}

fn delete_project_record_sync(app: &AppHandle, project_id: String) -> Result<(), String> {
    let _write_guard = lock_project_writes();
    let mut conn = open_db(app)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin delete transaction: {}", e))?;

    tx.execute("DELETE FROM projects WHERE id = ?1", params![project_id])
        .map_err(|e| format!("Failed to delete project: {}", e))?;
    tx.execute(
        "DELETE FROM project_image_refs WHERE project_id = ?1",
        params![project_id],
    )
    .map_err(|e| format!("Failed to delete project image refs: {}", e))?;

    super::agent_threads::delete_project_agent_data(&tx, &project_id)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit delete transaction: {}", e))?;

    // Delete project folder (uploads/ + outputs/)
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let project_dir = app_data_dir.join("projects").join(&project_id);
    if project_dir.exists() {
        std::fs::remove_dir_all(&project_dir).map_err(|e| {
            format!(
                "Failed to delete project directory {}: {}",
                project_dir.display(),
                e
            )
        })?;
    }

    prune_unreferenced_images(app, &conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::extract_project_image_paths;

    #[test]
    fn thumbnail_migration_preserves_legacy_project_data() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL, nodes_json TEXT NOT NULL, edges_json TEXT NOT NULL,
            viewport_json TEXT NOT NULL, history_json TEXT NOT NULL);
            INSERT INTO projects VALUES ('legacy', 'Old project', 1, 2, '[]', '[]', '{}', '{}');").unwrap();
        super::ensure_projects_table(&conn).unwrap();
        super::ensure_projects_table(&conn).unwrap();
        let (name, thumbnail, count): (String, Option<String>, i64) = conn.query_row(
            "SELECT name, thumbnail_url, node_count FROM projects WHERE id = 'legacy'", [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(name, "Old project");
        assert_eq!(thumbnail, None);
        assert_eq!(count, 0);
    }

    #[test]
    fn project_image_paths_include_node_and_storyboard_reference_derivatives() {
        let nodes_json = r#"[
            {
                "data": {
                    "imageUrl": "__img_ref__:0",
                    "previewImageUrl": "__img_ref__:1",
                    "referenceImageUrl": "__img_ref__:2",
                    "frames": [
                        {
                            "imageUrl": "__img_ref__:3",
                            "previewImageUrl": "__img_ref__:4",
                            "referenceImageUrl": "__img_ref__:5"
                        }
                    ]
                }
            }
        ]"#;
        let history_json = r#"{
            "imagePool": [
                "node-original",
                "node-preview",
                "node-reference",
                "frame-original",
                "frame-preview",
                "frame-reference"
            ],
            "past": [],
            "future": []
        }"#;

        let paths = extract_project_image_paths(nodes_json, history_json);

        assert_eq!(paths.len(), 6);
        assert!(paths.contains("node-reference"));
        assert!(paths.contains("frame-reference"));
    }
}
