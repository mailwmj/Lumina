use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::project_state::{lock_project_writes, open_db, run_blocking};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentThreadRecord {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub llm_api_id: Option<String>,
    pub llm_model_id: Option<String>,
    pub image_model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageRecord {
    pub id: String,
    pub thread_id: String,
    pub seq: i64,
    pub role: String,
    pub parts_json: String,
    pub metadata_json: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentNodeOriginRecord {
    pub node_id: String,
    pub project_id: String,
    pub thread_id: String,
    pub message_id: String,
}

pub(crate) fn ensure_agent_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS agent_threads (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            llm_api_id TEXT, llm_model_id TEXT, image_model_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_agent_threads_project ON agent_threads(project_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS agent_messages (
            id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, seq INTEGER NOT NULL,
            role TEXT NOT NULL, parts_json TEXT NOT NULL, metadata_json TEXT, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id, seq);
        CREATE TABLE IF NOT EXISTS agent_node_origins (
            node_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, message_id TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_node_origins_project ON agent_node_origins(project_id);
        CREATE INDEX IF NOT EXISTS idx_agent_node_origins_thread ON agent_node_origins(thread_id);
    ").map_err(|e| format!("Failed to initialize agent tables: {}", e))
}

fn list_agent_threads_sync(conn: &Connection, project_id: &str) -> Result<Vec<AgentThreadRecord>, String> {
    let mut stmt = conn.prepare("SELECT id, project_id, title, created_at, updated_at,
        llm_api_id, llm_model_id, image_model_id FROM agent_threads WHERE project_id = ?1 ORDER BY updated_at DESC")
        .map_err(|e| format!("Failed to prepare agent threads query: {}", e))?;
    let rows = stmt.query_map([project_id], |row| Ok(AgentThreadRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        llm_api_id: row.get(5)?,
        llm_model_id: row.get(6)?,
        image_model_id: row.get(7)?,
    })).map_err(|e| format!("Failed to query agent threads: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read agent threads: {}", e))
}

fn get_agent_thread_messages_sync(conn: &Connection, thread_id: &str) -> Result<Vec<AgentMessageRecord>, String> {
    let mut stmt = conn.prepare("SELECT id, thread_id, seq, role, parts_json, metadata_json, created_at
        FROM agent_messages WHERE thread_id = ?1 ORDER BY seq ASC")
        .map_err(|e| format!("Failed to prepare agent messages query: {}", e))?;
    let rows = stmt.query_map([thread_id], |row| Ok(AgentMessageRecord {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        seq: row.get(2)?,
        role: row.get(3)?,
        parts_json: row.get(4)?,
        metadata_json: row.get(5)?,
        created_at: row.get(6)?,
    })).map_err(|e| format!("Failed to query agent messages: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read agent messages: {}", e))
}

fn upsert_agent_thread_sync(conn: &Connection, thread: &AgentThreadRecord) -> Result<(), String> {
    conn.execute("INSERT INTO agent_threads (id, project_id, title, created_at, updated_at, llm_api_id, llm_model_id, image_model_id)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id, title = excluded.title, updated_at = excluded.updated_at,
        llm_api_id = excluded.llm_api_id, llm_model_id = excluded.llm_model_id, image_model_id = excluded.image_model_id",
        params![thread.id, thread.project_id, thread.title, thread.created_at, thread.updated_at,
            thread.llm_api_id, thread.llm_model_id, thread.image_model_id])
        .map_err(|e| format!("Failed to upsert agent thread: {}", e))?;
    Ok(())
}

fn upsert_agent_messages_sync(conn: &Connection, thread_id: &str, messages: &[AgentMessageRecord]) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin agent messages transaction: {}", e))?;
    for message in messages {
        if message.thread_id != thread_id {
            return Err(format!("Failed to upsert agent messages: message {} thread_id does not match {}", message.id, thread_id));
        }
        tx.execute("INSERT INTO agent_messages (id, thread_id, seq, role, parts_json, metadata_json, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO UPDATE SET
            seq = excluded.seq, role = excluded.role, parts_json = excluded.parts_json, metadata_json = excluded.metadata_json",
            params![message.id, message.thread_id, message.seq, message.role, message.parts_json, message.metadata_json, message.created_at])
            .map_err(|e| format!("Failed to upsert agent message: {}", e))?;
    }
    let now = chrono::Utc::now().timestamp_millis();
    let updated_at = messages.iter().map(|message| message.created_at).max().unwrap_or(now).max(now);
    tx.execute("UPDATE agent_threads SET updated_at = max(updated_at, ?1) WHERE id = ?2", params![updated_at, thread_id])
        .map_err(|e| format!("Failed to update agent thread timestamp: {}", e))?;
    tx.commit().map_err(|e| format!("Failed to commit agent messages transaction: {}", e))
}

fn delete_agent_thread_sync(conn: &Connection, thread_id: &str) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin delete agent thread transaction: {}", e))?;
    tx.execute("DELETE FROM agent_messages WHERE thread_id = ?1", [thread_id])
        .map_err(|e| format!("Failed to delete agent messages: {}", e))?;
    tx.execute("DELETE FROM agent_node_origins WHERE thread_id = ?1", [thread_id])
        .map_err(|e| format!("Failed to delete agent node origins: {}", e))?;
    tx.execute("DELETE FROM agent_threads WHERE id = ?1", [thread_id])
        .map_err(|e| format!("Failed to delete agent thread: {}", e))?;
    tx.commit().map_err(|e| format!("Failed to commit delete agent thread transaction: {}", e))
}

fn upsert_agent_node_origins_sync(conn: &Connection, origins: &[AgentNodeOriginRecord]) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| format!("Failed to begin agent node origins transaction: {}", e))?;
    for origin in origins {
        tx.execute("INSERT INTO agent_node_origins (node_id, project_id, thread_id, message_id) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(node_id) DO UPDATE SET project_id = excluded.project_id, thread_id = excluded.thread_id, message_id = excluded.message_id",
            params![origin.node_id, origin.project_id, origin.thread_id, origin.message_id])
            .map_err(|e| format!("Failed to upsert agent node origin: {}", e))?;
    }
    tx.commit().map_err(|e| format!("Failed to commit agent node origins transaction: {}", e))
}

fn list_agent_node_origins_sync(conn: &Connection, project_id: &str) -> Result<Vec<AgentNodeOriginRecord>, String> {
    let mut stmt = conn.prepare("SELECT node_id, project_id, thread_id, message_id FROM agent_node_origins WHERE project_id = ?1")
        .map_err(|e| format!("Failed to prepare agent node origins query: {}", e))?;
    let rows = stmt.query_map([project_id], |row| Ok(AgentNodeOriginRecord {
        node_id: row.get(0)?,
        project_id: row.get(1)?,
        thread_id: row.get(2)?,
        message_id: row.get(3)?,
    })).map_err(|e| format!("Failed to query agent node origins: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read agent node origins: {}", e))
}

pub(crate) fn delete_project_agent_data(tx: &Transaction<'_>, project_id: &str) -> Result<(), String> {
    tx.execute("DELETE FROM agent_messages WHERE thread_id IN (SELECT id FROM agent_threads WHERE project_id = ?1)", [project_id])
        .map_err(|e| format!("Failed to delete project agent messages: {}", e))?;
    tx.execute("DELETE FROM agent_threads WHERE project_id = ?1", [project_id])
        .map_err(|e| format!("Failed to delete project agent threads: {}", e))?;
    tx.execute("DELETE FROM agent_node_origins WHERE project_id = ?1", [project_id])
        .map_err(|e| format!("Failed to delete project agent node origins: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn list_agent_threads(app: AppHandle, project_id: String) -> Result<Vec<AgentThreadRecord>, String> {
    run_blocking("List agent threads", move || list_agent_threads_sync(&open_db(&app)?, &project_id)).await
}

#[tauri::command]
pub async fn get_agent_thread_messages(app: AppHandle, thread_id: String) -> Result<Vec<AgentMessageRecord>, String> {
    run_blocking("Get agent thread messages", move || get_agent_thread_messages_sync(&open_db(&app)?, &thread_id)).await
}

#[tauri::command]
pub async fn upsert_agent_thread(app: AppHandle, thread: AgentThreadRecord) -> Result<(), String> {
    run_blocking("Upsert agent thread", move || {
        let _guard = lock_project_writes();
        upsert_agent_thread_sync(&open_db(&app)?, &thread)
    })
    .await
}

#[tauri::command]
pub async fn upsert_agent_messages(app: AppHandle, thread_id: String, messages: Vec<AgentMessageRecord>) -> Result<(), String> {
    run_blocking("Upsert agent messages", move || {
        let _guard = lock_project_writes();
        upsert_agent_messages_sync(&open_db(&app)?, &thread_id, &messages)
    })
    .await
}

#[tauri::command]
pub async fn delete_agent_thread(app: AppHandle, thread_id: String) -> Result<(), String> {
    run_blocking("Delete agent thread", move || {
        let _guard = lock_project_writes();
        delete_agent_thread_sync(&open_db(&app)?, &thread_id)
    })
    .await
}

#[tauri::command]
pub async fn upsert_agent_node_origins(app: AppHandle, origins: Vec<AgentNodeOriginRecord>) -> Result<(), String> {
    run_blocking("Upsert agent node origins", move || {
        let _guard = lock_project_writes();
        upsert_agent_node_origins_sync(&open_db(&app)?, &origins)
    })
    .await
}

#[tauri::command]
pub async fn list_agent_node_origins(app: AppHandle, project_id: String) -> Result<Vec<AgentNodeOriginRecord>, String> {
    run_blocking("List agent node origins", move || list_agent_node_origins_sync(&open_db(&app)?, &project_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::project_state::ensure_projects_table;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        ensure_projects_table(&conn).unwrap();
        conn
    }

    fn thread(id: &str, project: &str, updated_at: i64) -> AgentThreadRecord {
        AgentThreadRecord {
            id: id.into(), project_id: project.into(), title: id.into(), created_at: 1, updated_at,
            llm_api_id: None, llm_model_id: None, image_model_id: None,
        }
    }

    fn message(id: &str, thread: &str, seq: i64) -> AgentMessageRecord {
        AgentMessageRecord {
            id: id.into(), thread_id: thread.into(), seq, role: "user".into(),
            parts_json: " opaque parts \n".into(), metadata_json: Some(" opaque metadata \n".into()), created_at: 3,
        }
    }

    fn seed(conn: &Connection, id: &str, project: &str) {
        upsert_agent_thread_sync(conn, &thread(id, project, 1)).unwrap();
        upsert_agent_messages_sync(conn, id, &[message(id, id, 1)]).unwrap();
        upsert_agent_node_origins_sync(conn, &[AgentNodeOriginRecord {
            node_id: id.into(), project_id: project.into(), thread_id: id.into(), message_id: id.into(),
        }]).unwrap();
    }

    #[test]
    fn legacy_upgrade_is_idempotent_and_preserves_project_data() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL, nodes_json TEXT NOT NULL, edges_json TEXT NOT NULL,
            viewport_json TEXT NOT NULL, history_json TEXT NOT NULL);
            INSERT INTO projects VALUES ('legacy', 'Old project', 1, 2, '[1]', '[2]', '{v}', '{h}');").unwrap();
        let snapshot = || conn.query_row("SELECT id, name, created_at, updated_at, nodes_json, edges_json, viewport_json, history_json FROM projects", [], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?, row.get::<_, String>(5)?, row.get::<_, String>(6)?, row.get::<_, String>(7)?))
        }).unwrap();
        let before = snapshot();
        ensure_projects_table(&conn).unwrap();
        ensure_projects_table(&conn).unwrap();
        assert_eq!(snapshot(), before);
        for table in ["agent_threads", "agent_messages", "agent_node_origins"] {
            let exists: i64 = conn.query_row("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |row| row.get(0)).unwrap();
            assert_eq!(exists, 1, "missing table {table}");
        }
    }

    #[test]
    fn message_upserts_are_idempotent_ordered_and_preserve_opaque_text() {
        let conn = db();
        upsert_agent_thread_sync(&conn, &thread("t", "p", 1)).unwrap();
        let mut later = message("later", "t", 2);
        let earlier = message("earlier", "t", 1);
        upsert_agent_messages_sync(&conn, "t", &[later.clone(), earlier.clone()]).unwrap();
        later.parts_json = " updated opaque parts \n".into();
        later.metadata_json = None;
        later.role = "assistant".into();
        later.seq = 3;
        upsert_agent_messages_sync(&conn, "t", &[later.clone()]).unwrap();
        assert_eq!(get_agent_thread_messages_sync(&conn, "t").unwrap(), vec![earlier.clone(), later]);
        // Distinct messages may share a sequence number.
        upsert_agent_messages_sync(&conn, "t", &[message("same-seq", "t", 1)]).unwrap();
        assert_eq!(get_agent_thread_messages_sync(&conn, "t").unwrap().len(), 3);
    }

    #[test]
    fn mismatched_thread_rolls_back_entire_message_batch() {
        let conn = db();
        upsert_agent_thread_sync(&conn, &thread("t", "p", 1)).unwrap();
        let error = upsert_agent_messages_sync(&conn, "t", &[message("valid", "t", 1), message("invalid", "other", 2)]).unwrap_err();
        assert!(error.contains("thread_id does not match"));
        let count: i64 = conn.query_row("SELECT count(*) FROM agent_messages", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
        assert_eq!(list_agent_threads_sync(&conn, "p").unwrap()[0].updated_at, 1);
    }

    #[test]
    fn deleting_thread_preserves_other_thread_in_same_project() {
        let conn = db();
        seed(&conn, "a", "p");
        seed(&conn, "b", "p");
        let other = list_agent_threads_sync(&conn, "p").unwrap().into_iter().find(|t| t.id == "b").unwrap();
        let messages = get_agent_thread_messages_sync(&conn, "b").unwrap();
        delete_agent_thread_sync(&conn, "a").unwrap();
        assert_eq!(list_agent_threads_sync(&conn, "p").unwrap(), vec![other]);
        assert!(get_agent_thread_messages_sync(&conn, "a").unwrap().is_empty());
        assert_eq!(get_agent_thread_messages_sync(&conn, "b").unwrap(), messages);
        let origins = list_agent_node_origins_sync(&conn, "p").unwrap();
        assert_eq!(origins.len(), 1);
        assert_eq!(origins[0].thread_id, "b");
    }

    #[test]
    fn deleting_project_agent_data_preserves_other_project() {
        let mut conn = db();
        seed(&conn, "a1", "a");
        seed(&conn, "a2", "a");
        seed(&conn, "b1", "b");
        let threads = list_agent_threads_sync(&conn, "b").unwrap();
        let messages = get_agent_thread_messages_sync(&conn, "b1").unwrap();
        let origins = list_agent_node_origins_sync(&conn, "b").unwrap();
        let tx = conn.transaction().unwrap();
        delete_project_agent_data(&tx, "a").unwrap();
        tx.commit().unwrap();
        assert!(list_agent_threads_sync(&conn, "a").unwrap().is_empty());
        assert!(get_agent_thread_messages_sync(&conn, "a1").unwrap().is_empty());
        assert!(get_agent_thread_messages_sync(&conn, "a2").unwrap().is_empty());
        assert!(list_agent_node_origins_sync(&conn, "a").unwrap().is_empty());
        assert_eq!(list_agent_threads_sync(&conn, "b").unwrap(), threads);
        assert_eq!(get_agent_thread_messages_sync(&conn, "b1").unwrap(), messages);
        assert_eq!(list_agent_node_origins_sync(&conn, "b").unwrap(), origins);
    }

    #[test]
    fn threads_are_project_scoped_sorted_and_bumped_by_messages() {
        let conn = db();
        for t in [thread("older", "p", 1), thread("newer", "p", 2), thread("foreign", "q", 3)] {
            upsert_agent_thread_sync(&conn, &t).unwrap();
        }
        assert_eq!(list_agent_threads_sync(&conn, "p").unwrap().iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["newer", "older"]);
        let before = chrono::Utc::now().timestamp_millis();
        upsert_agent_messages_sync(&conn, "older", &[message("m", "older", 1)]).unwrap();
        let threads = list_agent_threads_sync(&conn, "p").unwrap();
        assert_eq!(threads[0].id, "older");
        assert!(threads[0].updated_at >= before);
        let future = before + 60_000;
        let mut msg = message("future", "older", 2);
        msg.created_at = future;
        upsert_agent_messages_sync(&conn, "older", &[msg]).unwrap();
        assert_eq!(list_agent_threads_sync(&conn, "p").unwrap()[0].updated_at, future);
        upsert_agent_messages_sync(&conn, "older", &[]).unwrap();
        assert_eq!(list_agent_threads_sync(&conn, "p").unwrap()[0].updated_at, future);
    }

    #[test]
    fn thread_and_origin_upserts_update_mutable_fields() {
        let conn = db();
        seed(&conn, "t", "p");
        let mut updated = thread("t", "p", 5);
        updated.title = "Renamed".into();
        updated.llm_api_id = Some("api".into());
        updated.llm_model_id = Some("llm".into());
        updated.image_model_id = Some("image".into());
        upsert_agent_thread_sync(&conn, &updated).unwrap();
        assert_eq!(list_agent_threads_sync(&conn, "p").unwrap(), vec![updated]);
        let origin = AgentNodeOriginRecord {
            node_id: "t".into(), project_id: "q".into(), thread_id: "other".into(), message_id: "other-message".into(),
        };
        upsert_agent_node_origins_sync(&conn, &[origin.clone()]).unwrap();
        assert!(list_agent_node_origins_sync(&conn, "p").unwrap().is_empty());
        assert_eq!(list_agent_node_origins_sync(&conn, "q").unwrap(), vec![origin]);
    }
}
