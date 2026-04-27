use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::ai::error::AIError;
use crate::ai::{
    AIProvider, GenerateRequest, ProviderTaskHandle, ProviderTaskPollResult, ProviderTaskSubmission,
};

const API_BASE_URL: &str = "https://ark.cn-beijing.volces.com";
const SUBMIT_PATH: &str = "/api/v3/contents/generations/tasks";
const QUERY_PATH: &str = "/api/v3/contents/generations/tasks";
const POLL_INTERVAL_MS: u64 = 5000;
const MAX_DURATION_SECONDS: u64 = 300; // 5 minutes max

#[derive(Debug, Serialize)]
struct VideoSubmitContent {
    #[serde(rename = "type")]
    part_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_url: Option<ImageUrl>,
    /// Draft task reference - used when generating final video from a draft
    #[serde(skip_serializing_if = "Option::is_none")]
    draft_task: Option<DraftTaskRef>,
}

#[derive(Debug, Serialize)]
struct DraftTaskRef {
    id: String,
}

#[derive(Debug, Serialize)]
struct ImageUrl {
    url: String,
}

#[derive(Debug, Serialize)]
struct VideoSubmitRequest {
    model: String,
    content: Vec<VideoSubmitContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generate_audio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seed: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    camera_fixed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    watermark: Option<bool>,
    // SD 2.0 new params
    #[serde(skip_serializing_if = "Option::is_none")]
    draft: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<Tool>>,
}

#[derive(Debug, Serialize)]
struct Tool {
    #[serde(rename = "type")]
    tool_type: String,
}

#[derive(Debug, Deserialize)]
struct VideoSubmitResponse {
    // API returns "id" field, not "task_id"
    id: Option<String>,
    #[serde(rename = "task_id")]
    task_id: Option<String>,
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct VideoQueryResponse {
    #[serde(rename = "task_id")]
    task_id: Option<String>,
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
    #[serde(rename = "output_url")]
    output_url: Option<String>,
    // Handle nested data structure from some API versions
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<VideoQueryData>,
    // Handle content.video_url structure from Volc engine
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<VideoContent>,
    // Seed returned by the API (if supported)
    #[serde(skip_serializing_if = "Option::is_none")]
    seed: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct VideoContent {
    #[serde(rename = "video_url")]
    video_url: Option<String>,
    #[serde(rename = "output_url")]
    output_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum VideoQueryData {
    WithUrl(VideoDataUrl),
    Raw(Value),
}

#[derive(Debug, Deserialize)]
struct VideoDataUrl {
    #[serde(rename = "video_url")]
    video_url: Option<String>,
    #[serde(rename = "output_url")]
    output_url: Option<String>,
}

fn sanitize_model(model: &str) -> String {
    model
        .split_once('/')
        .map(|(_, bare)| bare.to_string())
        .unwrap_or_else(|| model.to_string())
}

pub struct VolcVideoProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl VolcVideoProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
        }
    }

    /// Convert local file path or blob URL to HTTP URL if possible
    /// For now, we only support HTTP URLs directly
    fn source_to_url(source: &str) -> Result<String, String> {
        let trimmed = source.trim();
        if trimmed.is_empty() {
            return Err("source is empty".to_string());
        }

        // Data URL - pass through directly, let the API handle it
        if trimmed.starts_with("data:") {
            return Ok(trimmed.to_string());
        }

        // HTTP URLs - pass through directly
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            return Ok(trimmed.to_string());
        }

        // Blob URLs - can't be used directly
        if trimmed.starts_with("blob:") {
            return Err("blob URLs not supported, please use HTTP URLs".to_string());
        }

        // Local file paths need to be converted - but we don't have a good way to serve them
        if !trimmed.contains("://") {
            return Err("local file paths not supported, please use HTTP URLs".to_string());
        }

        Err(format!("unsupported protocol: {}", trimmed))
    }

    async fn submit_task_internal(
        &self,
        api_key: &str,
        request: &GenerateRequest,
    ) -> Result<String, AIError> {
        let model = sanitize_model(&request.model);
        let has_reference = request
            .reference_images
            .as_deref()
            .map(|r| !r.is_empty())
            .unwrap_or(false);
        let draft_task_id = request.draft_task_id.clone();

        // Build content array
        let mut content = Vec::new();

        // Draft mode: generate final video from draft task
        // Content should only contain draft_task reference, no images or text needed
        if let Some(ref draft_id) = draft_task_id {
            info!("[VolcVideo] Draft mode: generating final video from draft task {}", draft_id);
            content.push(VideoSubmitContent {
                part_type: "draft_task".to_string(),
                role: None,
                text: None,
                image_url: None,
                draft_task: Some(DraftTaskRef { id: draft_id.clone() }),
            });
        } else if has_reference {
            let images_count = request.reference_images.as_deref().unwrap_or(&[]).len();
            info!("[VolcVideo] processing {} reference images", images_count);
            // Log all received reference images with their full content for debugging
            if let Some(refs) = request.reference_images.as_deref() {
                for (i, ref_img) in refs.iter().enumerate() {
                    info!("[VolcVideo] INPUT reference_image[{}]: {}", i, ref_img);
                }
            }
            let mut valid_images_count = 0;
            for (i, img_source) in request
                .reference_images
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .enumerate()
            {
                let url_preview = if img_source.len() > 100 { &img_source[..100] } else { img_source };
                info!("[VolcVideo] reference_image[{}] source: {}...", i, url_preview);
                match Self::source_to_url(img_source) {
                    Ok(url) => {
                        let url_display = if url.len() > 100 { &url[..100] } else { &url };
                        info!("[VolcVideo] reference_image[{}] converted successfully: {}...", i, url_display);
                        // Determine role based on position in CONTENT (not original index)
                        // For first/last frame mode (2 images): use "first_frame" or "last_frame"
                        // For single image mode: API doesn't require role for image content
                        // Bug fix: if some images fail source_to_url, we still want first valid image
                        // to get "first_frame" and second valid image to get "last_frame"
                        let role = if images_count == 2 {
                            if content.is_empty() {
                                Some("first_frame".to_string())
                            } else {
                                Some("last_frame".to_string())
                            }
                        } else {
                            None
                        };
                        info!("[VolcVideo] reference_image[{}] role: {:?}", i, role);
                        content.push(VideoSubmitContent {
                            part_type: "image_url".to_string(),
                            role,
                            text: None,
                            image_url: Some(ImageUrl { url }),
                            draft_task: None,
                        });
                        valid_images_count += 1;
                    }
                    Err(e) => {
                        info!("[VolcVideo] skip invalid reference image[{}]: {}", i, e);
                    }
                }
            }
            info!("[VolcVideo] valid images processed: {}/{}", valid_images_count, images_count);
            if valid_images_count < images_count {
                info!("[VolcVideo] WARNING: Some images were skipped!");
            }
            // Log the final content array with roles
            for (idx, item) in content.iter().enumerate() {
                let img_url_display = item.image_url.as_ref().map(|u| if u.url.len() > 80 { &u.url[..80] } else { &u.url }).unwrap_or("(none)");
                info!("[VolcVideo] content[{}]: type={}, role={:?}, image_url={}...", idx, item.part_type, item.role, img_url_display);
            }
        } else {
            info!("[VolcVideo] no reference images to process");
        }

        // Text prompt - keep clean without appended parameters
        let text_prompt = request.prompt.clone();

        // Extract parameters for request body
        let mut generate_audio = None;
        let mut resolution = None;
        let mut ratio = None;
        let mut duration = None;
        let mut seed = None;
        let mut camera_fixed = None;
        let mut watermark = None;
        // SD 2.0 new params
        let mut draft = None;
        let mut tools = None;

        // Map size to resolution
        // For draft_task mode, do not set resolution - it's inherited from draft video
        if !request.size.is_empty() && draft_task_id.is_none() {
            resolution = Some(request.size.clone());
        }

        // Map aspect_ratio to ratio
        // For draft_task mode, do not set ratio - it's inherited from draft video
        if !request.aspect_ratio.is_empty() && draft_task_id.is_none() {
            ratio = Some(request.aspect_ratio.clone());
        }

        // Extract from extra_params
        if let Some(extra) = &request.extra_params {
            if let Some(v) = extra.get("duration").and_then(|v| v.as_i64()) {
                duration = Some(v);
            }
            if let Some(v) = extra.get("camerafixed").and_then(|v| v.as_bool()) {
                camera_fixed = Some(v);
            }
            if let Some(v) = extra.get("watermark").and_then(|v| v.as_bool()) {
                watermark = Some(v);
            }
            if let Some(v) = extra.get("seed").and_then(|v| v.as_u64()) {
                seed = Some(v as i64);
            }
            // hasaudio: only set for non-draft mode (draft inherits audio from draft video)
            if draft_task_id.is_none() {
                if let Some(v) = extra.get("hasaudio").and_then(|v| v.as_bool()) {
                    generate_audio = Some(v);
                } else {
                    // Default: no audio
                    generate_audio = Some(false);
                }
            }
            // SD 2.0: draft mode
            if let Some(v) = extra.get("draft").and_then(|v| v.as_bool()) {
                draft = Some(v);
            }
            // SD 2.0: web search
            if let Some(v) = extra.get("enable_web_search").and_then(|v| v.as_bool()) {
                if v {
                    tools = Some(vec![Tool { tool_type: "web_search".to_string() }]);
                }
            }
        } else if draft_task_id.is_none() {
            // Default: no audio (only for non-draft mode)
            generate_audio = Some(false);
        }

        // Add text content (text content should NOT have role field)
        // Skip text for draft_task mode - the draft already has all the prompt info
        if draft_task_id.is_none() {
            content.push(VideoSubmitContent {
                part_type: "text".to_string(),
                role: None,
                text: Some(text_prompt),
                image_url: None,
                draft_task: None,
            });
        }

        let body = VideoSubmitRequest {
            model: model.clone(),
            content,
            generate_audio,
            resolution,
            ratio,
            duration,
            seed,
            camera_fixed,
            watermark,
            draft,
            tools,
        };

        let endpoint = format!("{}{}", API_BASE_URL, SUBMIT_PATH);

        info!(
            "[VolcVideo Submit] model: {}, has_ref: {}, prompt_len: {}, endpoint: {}, request_body: {}",
            model,
            has_reference,
            request.prompt.len(),
            endpoint,
            serde_json::to_string(&body).unwrap_or_default()
        );

        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| AIError::Provider(format!("VolcVideo request failed: {}", e)))?;

        let status = response.status();
        let raw_response = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "VolcVideo submit failed [{}]: {}",
                status, raw_response
            )));
        }

        let body: VideoSubmitResponse = serde_json::from_str(&raw_response)
            .map_err(|err| AIError::Provider(format!("VolcVideo parse error: {}, raw: {}", err, raw_response)))?;

        info!("[VolcVideo Submit] response: id={:?}, task_id={:?}, status={:?}, error={:?}",
              body.id, body.task_id, body.status, body.error);

        if let Some(error) = body.error {
            // Extract detailed error info from API response
            let msg = error.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error");
            let code = error.get("code").and_then(|v| v.as_str()).unwrap_or("");
            let param = error.get("param").and_then(|v| v.as_str()).unwrap_or("");
            let err_type = error.get("type").and_then(|v| v.as_str()).unwrap_or("");

            // Build detailed error message
            let detailed_msg = if !code.is_empty() {
                format!("[{}] {}", code, msg)
            } else {
                msg.to_string()
            };

            let final_msg = if !param.is_empty() || !err_type.is_empty() {
                format!("{} | param: {}, type: {}", detailed_msg, param, err_type)
            } else {
                detailed_msg
            };

            info!("[VolcVideo] API error detailed: code={}, message={}, param={}, type={}", code, msg, param, err_type);
            return Err(AIError::Provider(format!("VolcVideo API error: {}, raw: {}", final_msg, raw_response)));
        }

        // Use id if task_id is not present (API returns "id" field)
        body.task_id
            .or(body.id)
            .ok_or_else(|| {
                // Both task_id and id missing - log full response for debugging
                info!("[VolcVideo] Response missing both task_id and id. Full response: {}", raw_response);
                AIError::Provider(format!(
                    "VolcVideo API 返回缺少 task_id/id，可能原因：1) API地址错误；2) 模型ID无效；3) 请求格式错误。API返回: {}",
                    raw_response
                ))
            })
    }

    async fn poll_task_once(
        &self,
        api_key: &str,
        task_id: &str,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let endpoint = format!("{}{}/{}", API_BASE_URL, QUERY_PATH, task_id);
        info!("[VolcVideo Poll] querying task: {}, endpoint: {}, api_key present: {}",
              task_id, endpoint, !api_key.is_empty());

        let response = self
            .client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .send()
            .await
            .map_err(|e| {
                info!("[VolcVideo Poll] HTTP request failed: {}", e);
                AIError::Provider(format!("VolcVideo query failed: {}", e))
            })?;

        let status = response.status();
        let raw_response = response.text().await.unwrap_or_default();
        info!("[VolcVideo Poll] response status: {}, body: {}", status, raw_response);

        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "VolcVideo query failed [{}]: {}",
                status, raw_response
            )));
        }

        let body: VideoQueryResponse = serde_json::from_str(&raw_response)
            .map_err(|err| {
                info!("[VolcVideo Poll] JSON parse failed: {}, raw: {}", err, raw_response);
                AIError::Provider(format!("VolcVideo parse error: {}", err))
            })?;

        // Check for URL in content.video_url structure
        let content_video_url = body.content.as_ref().and_then(|c| {
            c.video_url.clone().or(c.output_url.clone())
        });

        // Check for URL in nested data structure if top-level output_url is missing
        let nested_video_url = body.data.as_ref().and_then(|d| {
            match d {
                VideoQueryData::WithUrl(url_obj) => {
                    url_obj.video_url.clone().or(url_obj.output_url.clone())
                }
                VideoQueryData::Raw(val) => {
                    val.get("video_url").and_then(|v| v.as_str()).map(String::from)
                    .or(val.get("output_url").and_then(|v| v.as_str()).map(String::from))
                }
            }
        });

        info!("[VolcVideo Poll] parsed response: task_id={:?}, status={:?}, output_url={:?}, content_video_url={:?}, nested_video_url={:?}, error={:?}",
              body.task_id, body.status, body.output_url, content_video_url, nested_video_url, body.error);

        if let Some(error) = body.error {
            let msg = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            info!("[VolcVideo Poll] API returned error: {}", msg);
            return Err(AIError::Provider(format!("VolcVideo error: {}", msg)));
        }

        match body.status.as_deref() {
            Some("succeeded") | Some("success") => {
                // Try top-level output_url first, then content.video_url, then nested URL
                let video_url = body.output_url.clone()
                    .or_else(|| content_video_url.clone())
                    .or_else(|| nested_video_url.clone())
                    .filter(|url| !url.is_empty());

                match video_url {
                    Some(url) => {
                        info!("[VolcVideo Poll] SUCCESS! video_url: {}, seed: {:?}", url, body.seed);
                        Ok(ProviderTaskPollResult::SucceededWithMeta {
                            url,
                            seed: body.seed,
                        })
                    }
                    _ => {
                        // If output_url is missing, treat as still running and poll again
                        // This handles cases where API returns success before URL is populated
                        info!("[VolcVideo Poll] status succeeded but output_url missing/empty");
                        return Ok(ProviderTaskPollResult::Running);
                    }
                }
            }
            Some("failed") => {
                info!("[VolcVideo Poll] status failed");
                Ok(ProviderTaskPollResult::Failed(
                    "Video generation failed".to_string(),
                ))
            }
            Some("queued") | Some("running") | Some("processing") | None => {
                info!("[VolcVideo Poll] status: {:?}, still running", body.status.as_deref());
                Ok(ProviderTaskPollResult::Running)
            }
            Some(other) => {
                info!("[VolcVideo Poll] unexpected status: {}", other);
                Err(AIError::Provider(format!(
                    "VolcVideo unexpected status: {}",
                    other
                )))
            }
        }
    }

    async fn poll_task_until_complete(
        &self,
        api_key: &str,
        task_id: &str,
    ) -> Result<String, AIError> {
        let mut elapsed_ms: u64 = 0;
        loop {
            if elapsed_ms >= MAX_DURATION_SECONDS * 1000 {
                return Err(AIError::TaskFailed("Video generation timeout".to_string()));
            }

            match self.poll_task_once(api_key, task_id).await? {
                ProviderTaskPollResult::Running => {
                    sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
                    elapsed_ms += POLL_INTERVAL_MS;
                }
                ProviderTaskPollResult::Succeeded(url) => return Ok(url),
                ProviderTaskPollResult::SucceededWithMeta { url, .. } => return Ok(url),
                ProviderTaskPollResult::Failed(message) => {
                    return Err(AIError::TaskFailed(message))
                }
            }
        }
    }
}

impl Default for VolcVideoProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for VolcVideoProvider {
    fn name(&self) -> &str {
        "volcvideo"
    }

    fn supports_model(&self, model: &str) -> bool {
        let model = sanitize_model(model);
        // Support all doubao-seedance variants (including user-configured ones)
        // Also accept explicit volcvideo/ prefix
        model == "doubao-seedance-1-5-pro-251215"
            || model.starts_with("doubao-seedance-")
            || model.starts_with("volcvideo/")
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "volcvideo/doubao-seedance-1-5-pro-251215".to_string(),
            "volcvideo/doubao-seedance-1-0-pro-250528".to_string(),
            "doubao-seedance-1-5-pro-251215".to_string(),
            "doubao-seedance-1-0-pro-250528".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    fn supports_task_resume(&self) -> bool {
        true
    }

    async fn submit_task(
        &self,
        request: GenerateRequest,
    ) -> Result<ProviderTaskSubmission, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let task_id = self.submit_task_internal(&api_key, &request).await?;
        info!("[VolcVideo] submit_task succeeded, returning task_id: {}", task_id);
        Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
            task_id,
            metadata: None,
        }))
    }

    async fn poll_task(&self, handle: ProviderTaskHandle) -> Result<ProviderTaskPollResult, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        self.poll_task_once(&api_key, handle.task_id.as_str())
            .await
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| AIError::InvalidRequest("API key not set".to_string()))?;

        let task_id = self.submit_task_internal(&api_key, &request).await?;
        self.poll_task_until_complete(&api_key, &task_id)
            .await
    }
}

/// Cancel a video generation task by calling DELETE endpoint
pub async fn cancel_volcvideo_task(
    api_key: &str,
    task_id: &str,
) -> Result<(), AIError> {
    let endpoint = format!("{}{}/{}", API_BASE_URL, QUERY_PATH, task_id);
    info!("[VolcVideo Cancel] cancelling task: {}, endpoint: {}", task_id, endpoint);

    let client = Client::new();
    let response = client
        .delete(&endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| AIError::Provider(format!("VolcVideo cancel request failed: {}", e)))?;

    let status = response.status();
    let raw_response = response.text().await.unwrap_or_default();

    info!("[VolcVideo Cancel] response status: {}, body: {}", status, raw_response);

    if status.is_success() || status.as_u16() == 404 {
        // 204 No Content or 404 means success (task cancelled or already gone)
        Ok(())
    } else {
        Err(AIError::Provider(format!(
            "VolcVideo cancel failed [{}]: {}",
            status, raw_response
        )))
    }
}
