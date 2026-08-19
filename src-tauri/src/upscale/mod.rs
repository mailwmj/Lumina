mod cache;
mod input;
mod sidecar;

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Semaphore;
use tracing::warn;
use uuid::Uuid;

use self::cache::{
    build_cache_key, lookup_cache_entry, materialize_project_output, prune_cache_to_limit,
    publish_cache_output, record_cache_entry, resolve_cache_dir,
};
use self::input::{preprocess_source, validate_start_request};
use self::sidecar::{
    model_sha256, resolve_model_dir, resolve_sidecar_binary, run_sidecar, validate_sidecar_output,
};

pub(crate) use self::cache::ensure_upscale_cache_schema;

pub(crate) const MAX_OUTPUT_PIXELS: u64 = 268_435_456;
pub(crate) const MAX_OUTPUT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_UPSCALE_CACHE_BYTES: u64 = 10 * 1024 * 1024 * 1024;

pub(crate) const STATUS_QUEUED: &str = "queued";
pub(crate) const STATUS_RUNNING: &str = "running";
pub(crate) const STATUS_SUCCEEDED: &str = "succeeded";
pub(crate) const STATUS_FAILED: &str = "failed";
pub(crate) const STATUS_CANCELLED: &str = "cancelled";

pub(crate) const ERROR_MISSING_INPUT: &str = "missing_input";
pub(crate) const ERROR_INVALID_INPUT_SOURCE: &str = "invalid_input_source";
pub(crate) const ERROR_INVALID_SCALE: &str = "invalid_scale";
pub(crate) const ERROR_UNSUPPORTED_COLOR_PROFILE: &str = "unsupported_color_profile";
pub(crate) const ERROR_UNSUPPORTED_IMAGE: &str = "unsupported_image";
pub(crate) const ERROR_IMAGE_TOO_LARGE: &str = "image_too_large";
pub(crate) const ERROR_SIDECAR_UNAVAILABLE: &str = "sidecar_unavailable";
pub(crate) const ERROR_SIDECAR_FAILED: &str = "sidecar_failed";
pub(crate) const ERROR_CANCELLED: &str = "cancelled";
pub(crate) const ERROR_CACHE_FAILED: &str = "cache_failed";
pub(crate) const ERROR_JOB_NOT_FOUND: &str = "job_not_found";
pub(crate) const ERROR_INTERNAL: &str = "internal_error";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartUpscaleJobRequest {
    pub project_id: String,
    pub source_image_url: String,
    pub scale: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleJobSnapshot {
    pub job_id: String,
    pub status: String,
    pub progress: u8,
    pub phase: String,
    pub output_image_url: Option<String>,
    pub result_image_url: Option<String>,
    pub preview_image_url: Option<String>,
    pub aspect_ratio: Option<String>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleCommandError {
    pub code: String,
    pub error_code: String,
}

impl UpscaleCommandError {
    fn new(code: impl Into<String>) -> Self {
        let code = code.into();
        Self {
            error_code: code.clone(),
            code,
        }
    }
}

#[derive(Debug)]
pub(crate) struct UpscaleFailure {
    pub(crate) code: &'static str,
    pub(crate) detail: String,
}

impl UpscaleFailure {
    pub(crate) fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }

    fn command_error(self) -> UpscaleCommandError {
        warn!(error_code = self.code, detail = %self.detail, "upscale request failed");
        UpscaleCommandError::new(self.code)
    }
}

#[derive(Clone)]
pub(crate) struct JobControl {
    pub(crate) cancel_requested: Arc<AtomicBool>,
    pub(crate) child: Arc<Mutex<Option<std::process::Child>>>,
}

struct JobEntry {
    snapshot: UpscaleJobSnapshot,
    control: JobControl,
}

#[derive(Clone)]
pub(crate) struct JobRequest {
    pub(crate) project_dir: PathBuf,
    pub(crate) source_path: PathBuf,
    pub(crate) scale: u8,
}

struct UpscaleJobManagerInner {
    jobs: Mutex<HashMap<String, JobEntry>>,
    gpu_semaphore: Arc<Semaphore>,
}

#[derive(Clone)]
pub struct UpscaleJobManager {
    inner: Arc<UpscaleJobManagerInner>,
}

impl UpscaleJobManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(UpscaleJobManagerInner {
                jobs: Mutex::new(HashMap::new()),
                gpu_semaphore: Arc::new(Semaphore::new(1)),
            }),
        }
    }

    pub fn shutdown(&self) {
        let controls = match self.inner.jobs.lock() {
            Ok(mut jobs) => jobs
                .values_mut()
                .filter_map(|entry| {
                    if is_terminal_status(&entry.snapshot.status) {
                        return None;
                    }
                    entry
                        .control
                        .cancel_requested
                        .store(true, Ordering::Release);
                    entry.snapshot.status = STATUS_CANCELLED.to_string();
                    entry.snapshot.phase = "cancelled".to_string();
                    entry.snapshot.error = None;
                    entry.snapshot.error_code = Some(ERROR_CANCELLED.to_string());
                    Some(entry.control.clone())
                })
                .collect::<Vec<_>>(),
            Err(_) => return,
        };

        for control in controls {
            if let Ok(mut child) = control.child.lock() {
                if let Some(child) = child.as_mut() {
                    terminate_and_reap(child);
                }
            }
        }
    }

    fn start(
        &self,
        app: AppHandle,
        request: StartUpscaleJobRequest,
    ) -> Result<UpscaleJobSnapshot, UpscaleCommandError> {
        let job_request =
            validate_start_request(&app, request).map_err(UpscaleFailure::command_error)?;
        let job_id = Uuid::new_v4().to_string();
        let snapshot = UpscaleJobSnapshot {
            job_id: job_id.clone(),
            status: STATUS_QUEUED.to_string(),
            progress: 0,
            phase: "queued".to_string(),
            output_image_url: None,
            result_image_url: None,
            preview_image_url: None,
            aspect_ratio: None,
            error: None,
            error_code: None,
        };
        let control = JobControl {
            cancel_requested: Arc::new(AtomicBool::new(false)),
            child: Arc::new(Mutex::new(None)),
        };

        self.inner
            .jobs
            .lock()
            .map_err(|_| UpscaleCommandError::new(ERROR_INTERNAL))?
            .insert(
                job_id.clone(),
                JobEntry {
                    snapshot: snapshot.clone(),
                    control,
                },
            );

        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            manager.run_job(app, job_id, job_request).await;
        });

        Ok(snapshot)
    }

    fn get_snapshot(&self, job_id: &str) -> Result<UpscaleJobSnapshot, UpscaleCommandError> {
        self.inner
            .jobs
            .lock()
            .map_err(|_| UpscaleCommandError::new(ERROR_INTERNAL))?
            .get(job_id)
            .map(|entry| entry.snapshot.clone())
            .ok_or_else(|| UpscaleCommandError::new(ERROR_JOB_NOT_FOUND))
    }

    fn cancel(&self, job_id: &str) -> Result<UpscaleJobSnapshot, UpscaleCommandError> {
        let (control, snapshot) = {
            let mut jobs = self
                .inner
                .jobs
                .lock()
                .map_err(|_| UpscaleCommandError::new(ERROR_INTERNAL))?;
            let entry = jobs
                .get_mut(job_id)
                .ok_or_else(|| UpscaleCommandError::new(ERROR_JOB_NOT_FOUND))?;

            if is_terminal_status(&entry.snapshot.status) {
                return Ok(entry.snapshot.clone());
            }

            entry
                .control
                .cancel_requested
                .store(true, Ordering::Release);
            entry.snapshot.status = STATUS_CANCELLED.to_string();
            entry.snapshot.phase = "cancelled".to_string();
            entry.snapshot.error = None;
            entry.snapshot.error_code = Some(ERROR_CANCELLED.to_string());
            (entry.control.clone(), entry.snapshot.clone())
        };

        if let Ok(mut child) = control.child.lock() {
            if let Some(child) = child.as_mut() {
                terminate_and_reap(child);
            }
        }

        Ok(snapshot)
    }

    async fn run_job(&self, app: AppHandle, job_id: String, request: JobRequest) {
        self.update_active_snapshot(&job_id, STATUS_QUEUED, 5, "waiting_for_gpu");

        let permit = match self.inner.gpu_semaphore.clone().acquire_owned().await {
            Ok(permit) => permit,
            Err(error) => {
                self.mark_failed(
                    &job_id,
                    ERROR_INTERNAL,
                    format!("GPU queue unavailable: {error}"),
                );
                return;
            }
        };

        let control = match self.job_control(&job_id) {
            Some(control) => control,
            None => return,
        };
        if control.cancel_requested.load(Ordering::Acquire) {
            self.mark_cancelled(&job_id);
            drop(permit);
            return;
        }

        self.update_active_snapshot(&job_id, STATUS_RUNNING, 10, "preprocessing");
        let manager = self.clone();
        let app_for_worker = app.clone();
        let job_id_for_worker = job_id.clone();
        let worker = tokio::task::spawn_blocking(move || {
            execute_job(
                &manager,
                &app_for_worker,
                &job_id_for_worker,
                &request,
                &control,
            )
        });

        let result = match worker.await {
            Ok(result) => result,
            Err(error) => Err(UpscaleFailure::new(
                ERROR_INTERNAL,
                format!("upscale worker stopped unexpectedly: {error}"),
            )),
        };
        drop(permit);

        match result {
            Ok(output_path) => {
                let cancelled = self
                    .job_control(&job_id)
                    .is_some_and(|control| control.cancel_requested.load(Ordering::Acquire));
                if cancelled || !self.mark_succeeded(&job_id, output_path.clone()) {
                    let _ = fs::remove_file(output_path);
                    self.mark_cancelled(&job_id);
                }
            }
            Err(error) if error.code == ERROR_CANCELLED => self.mark_cancelled(&job_id),
            Err(error) => {
                if self
                    .job_control(&job_id)
                    .is_some_and(|control| control.cancel_requested.load(Ordering::Acquire))
                {
                    self.mark_cancelled(&job_id);
                } else {
                    self.mark_failed(&job_id, error.code, error.detail);
                }
            }
        }
    }

    fn job_control(&self, job_id: &str) -> Option<JobControl> {
        self.inner
            .jobs
            .lock()
            .ok()
            .and_then(|jobs| jobs.get(job_id).map(|entry| entry.control.clone()))
    }

    fn update_active_snapshot(&self, job_id: &str, status: &str, progress: u8, phase: &str) {
        let Ok(mut jobs) = self.inner.jobs.lock() else {
            return;
        };
        let Some(entry) = jobs.get_mut(job_id) else {
            return;
        };
        if is_terminal_status(&entry.snapshot.status)
            || entry.control.cancel_requested.load(Ordering::Acquire)
        {
            return;
        }
        entry.snapshot.status = status.to_string();
        entry.snapshot.progress = progress;
        entry.snapshot.phase = phase.to_string();
    }

    fn mark_succeeded(&self, job_id: &str, output_path: String) -> bool {
        let Ok(mut jobs) = self.inner.jobs.lock() else {
            return false;
        };
        let Some(entry) = jobs.get_mut(job_id) else {
            return false;
        };
        if entry.control.cancel_requested.load(Ordering::Acquire)
            || entry.snapshot.status == STATUS_CANCELLED
        {
            return false;
        }
        entry.snapshot.status = STATUS_SUCCEEDED.to_string();
        entry.snapshot.progress = 100;
        entry.snapshot.phase = "completed".to_string();
        entry.snapshot.output_image_url = Some(output_path);
        entry.snapshot.result_image_url = entry.snapshot.output_image_url.clone();
        entry.snapshot.preview_image_url = entry.snapshot.output_image_url.clone();
        entry.snapshot.aspect_ratio = None;
        entry.snapshot.error = None;
        entry.snapshot.error_code = None;
        true
    }

    fn mark_cancelled(&self, job_id: &str) {
        let Ok(mut jobs) = self.inner.jobs.lock() else {
            return;
        };
        let Some(entry) = jobs.get_mut(job_id) else {
            return;
        };
        if entry.snapshot.status == STATUS_SUCCEEDED {
            return;
        }
        entry.snapshot.status = STATUS_CANCELLED.to_string();
        entry.snapshot.phase = "cancelled".to_string();
        entry.snapshot.error = None;
        entry.snapshot.error_code = Some(ERROR_CANCELLED.to_string());
    }

    fn mark_failed(&self, job_id: &str, error_code: &str, detail: String) {
        warn!(%job_id, %error_code, %detail, "upscale job failed");
        let Ok(mut jobs) = self.inner.jobs.lock() else {
            return;
        };
        let Some(entry) = jobs.get_mut(job_id) else {
            return;
        };
        if entry.control.cancel_requested.load(Ordering::Acquire)
            || entry.snapshot.status == STATUS_CANCELLED
        {
            return;
        }
        entry.snapshot.status = STATUS_FAILED.to_string();
        entry.snapshot.phase = "failed".to_string();
        entry.snapshot.error = Some(error_code.to_string());
        entry.snapshot.error_code = Some(error_code.to_string());
    }
}

pub(crate) fn cleanup_stale_temp_dirs(app: &AppHandle) {
    let projects_dir = match app.path().app_data_dir() {
        Ok(app_data_dir) => app_data_dir.join("projects"),
        Err(error) => {
            warn!(%error, "failed to resolve app data directory for upscale temporary cleanup");
            return;
        }
    };
    cleanup_stale_temp_dirs_in_projects(&projects_dir);
}

fn cleanup_stale_temp_dirs_in_projects(projects_dir: &std::path::Path) {
    let entries = match fs::read_dir(projects_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            warn!(path = %projects_dir.display(), %error, "failed to list projects for upscale temporary cleanup");
            return;
        }
    };

    for entry in entries.flatten() {
        let Ok(project_dir) = entry.path().canonicalize() else {
            continue;
        };
        if !project_dir.is_dir() {
            continue;
        }
        let Ok(temp_dir) = project_dir.join(".upscale-tmp").canonicalize() else {
            continue;
        };
        if temp_dir.parent() != Some(project_dir.as_path()) {
            warn!(path = %temp_dir.display(), "refusing to remove an upscale temporary directory outside its project");
            continue;
        }
        if let Err(error) = fs::remove_dir_all(&temp_dir) {
            warn!(path = %temp_dir.display(), %error, "failed to remove stale upscale temporary directory");
        }
    }
}

#[tauri::command]
pub fn start_upscale_job(
    app: AppHandle,
    manager: State<'_, UpscaleJobManager>,
    project_id: String,
    source_image_url: String,
    scale: u8,
) -> Result<UpscaleJobSnapshot, UpscaleCommandError> {
    manager.inner().start(
        app,
        StartUpscaleJobRequest {
            project_id,
            source_image_url,
            scale,
        },
    )
}

#[tauri::command]
pub fn get_upscale_job_status(
    manager: State<'_, UpscaleJobManager>,
    job_id: String,
) -> Result<UpscaleJobSnapshot, UpscaleCommandError> {
    manager.inner().get_snapshot(&job_id)
}

#[tauri::command]
pub fn cancel_upscale_job(
    manager: State<'_, UpscaleJobManager>,
    job_id: String,
) -> Result<UpscaleJobSnapshot, UpscaleCommandError> {
    manager.inner().cancel(&job_id)
}

fn execute_job(
    manager: &UpscaleJobManager,
    app: &AppHandle,
    job_id: &str,
    request: &JobRequest,
    control: &JobControl,
) -> Result<String, UpscaleFailure> {
    let work_dir = request.project_dir.join(".upscale-tmp").join(job_id);
    let result = (|| {
        if control.cancel_requested.load(Ordering::Acquire) {
            return Err(UpscaleFailure::new(
                ERROR_CANCELLED,
                "cancelled before preprocessing",
            ));
        }
        if !request.project_dir.is_dir() {
            return Err(UpscaleFailure::new(
                ERROR_INVALID_INPUT_SOURCE,
                "project directory no longer exists",
            ));
        }
        fs::create_dir_all(&work_dir).map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to create job directory: {error}"),
            )
        })?;

        manager.update_active_snapshot(job_id, STATUS_RUNNING, 20, "preprocessing");
        let prepared = preprocess_source(&request.source_path, &work_dir, request.scale)?;
        if control.cancel_requested.load(Ordering::Acquire) {
            return Err(UpscaleFailure::new(
                ERROR_CANCELLED,
                "cancelled during preprocessing",
            ));
        }

        manager.update_active_snapshot(job_id, STATUS_RUNNING, 30, "resolving_model");
        let model_dir = resolve_model_dir(app)?;
        let model_sha256 = model_sha256(&model_dir)?;
        let cache_key = build_cache_key(&prepared.source_sha256, request.scale, &model_sha256);
        let cache_dir = resolve_cache_dir(app)?;
        let mut conn = crate::commands::project_state::open_db(app).map_err(|error| {
            UpscaleFailure::new(
                ERROR_CACHE_FAILED,
                format!("failed to open cache database: {error}"),
            )
        })?;

        let output_dir = request.project_dir.join("outputs").join("images");
        if !output_dir.is_dir() {
            return Err(UpscaleFailure::new(
                ERROR_INVALID_INPUT_SOURCE,
                "project output directory no longer exists",
            ));
        }

        manager.update_active_snapshot(job_id, STATUS_RUNNING, 40, "checking_cache");
        if let Some(cache_path) = lookup_cache_entry(&conn, &cache_dir, &cache_key)? {
            if control.cancel_requested.load(Ordering::Acquire) {
                return Err(UpscaleFailure::new(
                    ERROR_CANCELLED,
                    "cancelled before cache output",
                ));
            }
            manager.update_active_snapshot(job_id, STATUS_RUNNING, 90, "materializing_cache");
            return materialize_project_output(&cache_path, &output_dir, job_id);
        }

        if control.cancel_requested.load(Ordering::Acquire) {
            return Err(UpscaleFailure::new(
                ERROR_CANCELLED,
                "cancelled before sidecar start",
            ));
        }
        let sidecar = resolve_sidecar_binary()?;
        let sidecar_output = work_dir.join("upscaled.png");
        manager.update_active_snapshot(job_id, STATUS_RUNNING, 50, "upscaling");
        run_sidecar(
            &sidecar,
            &model_dir,
            &prepared.normalized_path,
            &sidecar_output,
            request.scale,
            control,
        )?;
        if control.cancel_requested.load(Ordering::Acquire) {
            return Err(UpscaleFailure::new(
                ERROR_CANCELLED,
                "cancelled after sidecar exit",
            ));
        }
        validate_sidecar_output(
            &sidecar_output,
            prepared.expected_width,
            prepared.expected_height,
        )?;

        manager.update_active_snapshot(job_id, STATUS_RUNNING, 80, "writing_cache");
        let cache_path = cache_dir.join(format!("{cache_key}.png"));
        publish_cache_output(&sidecar_output, &cache_path)?;
        record_cache_entry(
            &mut conn,
            &cache_path,
            &cache_key,
            &prepared.source_sha256,
            request.scale,
        )?;
        prune_cache_to_limit(&mut conn, &cache_dir, MAX_UPSCALE_CACHE_BYTES)?;

        if control.cancel_requested.load(Ordering::Acquire) {
            return Err(UpscaleFailure::new(
                ERROR_CANCELLED,
                "cancelled before output publish",
            ));
        }
        manager.update_active_snapshot(job_id, STATUS_RUNNING, 90, "materializing_output");
        materialize_project_output(&cache_path, &output_dir, job_id)
    })();

    if let Err(error) = fs::remove_dir_all(&work_dir) {
        if work_dir.exists() {
            warn!(path = %work_dir.display(), %error, "failed to remove upscale temporary directory");
        }
    }
    result
}

fn is_terminal_status(status: &str) -> bool {
    matches!(status, STATUS_SUCCEEDED | STATUS_FAILED | STATUS_CANCELLED)
}

fn terminate_and_reap(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::cleanup_stale_temp_dirs_in_projects;

    #[test]
    fn startup_cleanup_removes_only_project_upscale_temporary_files() {
        let projects_dir =
            std::env::temp_dir().join(format!("lumina-upscale-projects-{}", Uuid::new_v4()));
        let stale_file = projects_dir
            .join("project-id")
            .join(".upscale-tmp")
            .join("job")
            .join("input.png");
        let retained_file = projects_dir
            .join("project-id")
            .join("uploads")
            .join("portrait.png");
        fs::create_dir_all(stale_file.parent().expect("temporary parent"))
            .expect("create temporary directory");
        fs::create_dir_all(retained_file.parent().expect("uploads parent"))
            .expect("create uploads directory");
        fs::write(&stale_file, b"temporary").expect("write temporary file");
        fs::write(&retained_file, b"retained").expect("write retained file");

        cleanup_stale_temp_dirs_in_projects(&projects_dir);

        assert!(!stale_file.exists());
        assert!(retained_file.exists());
        let _ = fs::remove_dir_all(projects_dir);
    }
}
