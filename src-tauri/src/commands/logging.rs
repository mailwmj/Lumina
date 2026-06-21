use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::session::SessionId;

#[derive(Deserialize)]
pub struct FrontendLogEntry {
    pub level: String,
    pub target: String,
    pub message: String,
    pub fields: Option<serde_json::Value>,
    pub ts_ms: i64,
}

#[tauri::command]
pub async fn append_frontend_log(app: AppHandle, entry: FrontendLogEntry) -> Result<(), String> {
    let session_id = app
        .state::<SessionId>()
        .0
        .clone();
    let fields = entry.fields.unwrap_or(serde_json::json!({}));
    let enriched = serde_json::json!({
        "session": session_id,
        "client_ts_ms": entry.ts_ms,
        "fields": fields,
    });

    match entry.level.as_str() {
        "debug" => tracing::debug!(target: "frontend", ns = %entry.target, data = %enriched, "{}", entry.message),
        "info"  => tracing::info!(target:  "frontend", ns = %entry.target, data = %enriched, "{}", entry.message),
        "warn"  => tracing::warn!(target:  "frontend", ns = %entry.target, data = %enriched, "{}", entry.message),
        "error" => tracing::error!(target: "frontend", ns = %entry.target, data = %enriched, "{}", entry.message),
        _ => return Err(format!("invalid level: {}", entry.level)),
    }
    Ok(())
}