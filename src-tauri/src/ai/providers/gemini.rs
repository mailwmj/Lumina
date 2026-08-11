use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
use tracing::info;

use super::image_input::load_reference_image;
use crate::ai::error::AIError;
use crate::ai::{
    AIProvider, GenerateRequest, ProviderTaskHandle, ProviderTaskPollResult, ProviderTaskSubmission,
};

const GEMINI_NATIVE_PROVIDER_ID: &str = "gemini";
const GEMINI_NATIVE_DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";
const POLL_INTERVAL_MS: u64 = 2_000;
const MAX_SYNC_POLL_ATTEMPTS: usize = 180;

pub struct GeminiNativeImageProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl GeminiNativeImageProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
        }
    }

    fn config_value(request: &GenerateRequest, key: &str) -> Option<String> {
        request
            .provider_config
            .as_ref()
            .and_then(|config| config.get(key))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn normalize_base_url(input: Option<String>) -> Result<String, AIError> {
        let base_url = input.unwrap_or_else(|| GEMINI_NATIVE_DEFAULT_BASE_URL.to_string());
        let mut url = reqwest::Url::parse(base_url.trim()).map_err(|error| {
            AIError::InvalidRequest(format!("Gemini Native Base URL is invalid: {}", error))
        })?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(AIError::InvalidRequest(
                "Gemini Native Base URL only supports HTTP(S)".to_string(),
            ));
        }
        if url.path().trim_matches('/').is_empty() {
            url.set_path("/v1beta");
        }
        url.set_query(None);
        url.set_fragment(None);
        Ok(url.to_string().trim_end_matches('/').to_string())
    }

    fn resolve_model(request: &GenerateRequest) -> Result<String, AIError> {
        let mut model = request
            .model
            .strip_prefix("gemini/")
            .unwrap_or(request.model.as_str())
            .trim();
        while model.starts_with("models/") || model.starts_with("gemini/") {
            model = model
                .strip_prefix("models/")
                .or_else(|| model.strip_prefix("gemini/"))
                .unwrap_or(model);
        }
        if model.is_empty() {
            return Err(AIError::InvalidRequest(
                "Gemini Native image model is required".to_string(),
            ));
        }
        Ok(model.to_string())
    }

    async fn api_key_for_request(&self, request: &GenerateRequest) -> Result<String, AIError> {
        if let Some(api_key) = Self::config_value(request, "api_key") {
            return Ok(api_key);
        }

        self.api_key.read().await.clone().ok_or_else(|| {
            AIError::InvalidRequest("Gemini Native image API key is not configured".to_string())
        })
    }

    async fn configured_api_key(&self) -> Result<String, AIError> {
        self.api_key.read().await.clone().ok_or_else(|| {
            AIError::InvalidRequest("Gemini Native image API key is not configured".to_string())
        })
    }

    async fn build_request_body(&self, request: &GenerateRequest) -> Result<Value, AIError> {
        let mut parts = vec![json!({ "text": request.prompt })];
        for source in request.reference_images.as_deref().unwrap_or(&[]) {
            let image = load_reference_image(&self.client, source).await?;
            parts.push(json!({
                "inlineData": {
                    "mimeType": image.mime_type,
                    "data": STANDARD.encode(image.bytes),
                }
            }));
        }

        Ok(json!({
            "contents": [{
                "role": "user",
                "parts": parts,
            }],
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
                "imageConfig": {
                    "aspectRatio": request.aspect_ratio,
                    "imageSize": request.size,
                }
            }
        }))
    }

    fn response_error_message(body: &Value) -> String {
        body.pointer("/error/message")
            .and_then(Value::as_str)
            .or_else(|| body.pointer("/error/status").and_then(Value::as_str))
            .or_else(|| body.get("error_message").and_then(Value::as_str))
            .or_else(|| body.get("error").and_then(Value::as_str))
            .or_else(|| body.get("message").and_then(Value::as_str))
            .or_else(|| body.get("error_code").and_then(Value::as_str))
            .unwrap_or("Gemini Native image request failed")
            .to_string()
    }

    fn response_image_source(body: &Value) -> Option<String> {
        for pointer in [
            "/assets/0/signed_url",
            "/assets/0/url",
            "/output/url",
            "/data/0/url",
        ] {
            if let Some(url) = body.pointer(pointer).and_then(Value::as_str) {
                if !url.trim().is_empty() {
                    return Some(url.to_string());
                }
            }
        }

        body.get("candidates")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|candidate| candidate.pointer("/content/parts").and_then(Value::as_array))
            .flatten()
            .find_map(|part| {
                let inline_data = part.get("inlineData").or_else(|| part.get("inline_data"))?;
                let data = inline_data.get("data").and_then(Value::as_str)?.trim();
                if data.is_empty() {
                    return None;
                }
                let mime_type = inline_data
                    .get("mimeType")
                    .or_else(|| inline_data.get("mime_type"))
                    .and_then(Value::as_str)
                    .filter(|value| value.starts_with("image/"))
                    .unwrap_or("image/png");
                Some(format!("data:{};base64,{}", mime_type, data))
            })
    }

    fn response_task_id(body: &Value) -> Option<String> {
        ["task_id", "id", "request_id"]
            .into_iter()
            .filter_map(|key| body.get(key).and_then(Value::as_str))
            .map(str::trim)
            .find(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn task_status_url(body: &Value) -> Option<String> {
        body.get("status_url")
            .or_else(|| body.get("poll_url"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn metadata_base_url(handle: &ProviderTaskHandle) -> Option<String> {
        handle
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("base_url"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn metadata_status_url(handle: &ProviderTaskHandle) -> Option<String> {
        handle
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("status_url"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    fn resolve_endpoint(base_url: &str, endpoint: &str) -> String {
        if endpoint.starts_with("http://") || endpoint.starts_with("https://") {
            return endpoint.to_string();
        }

        if endpoint.starts_with('/') {
            return reqwest::Url::parse(base_url)
                .ok()
                .and_then(|url| url.join(endpoint).ok())
                .map(|url| url.to_string())
                .unwrap_or_else(|| format!("{}{}", base_url.trim_end_matches('/'), endpoint));
        }

        format!("{}/{}", base_url.trim_end_matches('/'), endpoint)
    }

    fn generate_content_endpoint(base_url: &str, model: &str) -> String {
        format!(
            "{}/models/{}:generateContent",
            base_url,
            urlencoding::encode(model)
        )
    }

    fn fallback_v1beta_base_url(base_url: &str) -> Option<String> {
        let mut url = reqwest::Url::parse(base_url).ok()?;
        let path = url.path().trim_end_matches('/');
        let path_prefix = path.strip_suffix("/v1")?;
        url.set_path(format!("{path_prefix}/v1beta").as_str());
        Some(url.to_string().trim_end_matches('/').to_string())
    }

    fn is_html_not_found(status: StatusCode, body: &str) -> bool {
        if status != StatusCode::NOT_FOUND {
            return false;
        }

        let body = body.trim_start().to_ascii_lowercase();
        body.starts_with("<!doctype html") || body.starts_with("<html")
    }

    fn response_body_excerpt(raw: &str) -> String {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return "empty response body".to_string();
        }

        const MAX_CHARS: usize = 500;
        let excerpt: String = trimmed.chars().take(MAX_CHARS).collect();
        if trimmed.chars().nth(MAX_CHARS).is_some() {
            format!("{excerpt}...")
        } else {
            excerpt
        }
    }

    fn parse_submit_response(
        endpoint: &str,
        status: StatusCode,
        raw: &str,
    ) -> Result<Value, AIError> {
        if !status.is_success() {
            let message = serde_json::from_str::<Value>(raw)
                .map(|body| Self::response_error_message(&body))
                .unwrap_or_else(|_| {
                    format!("non-JSON response: {}", Self::response_body_excerpt(raw))
                });
            return Err(AIError::Provider(format!(
                "Gemini Native image API returned {} at {}: {}",
                status, endpoint, message
            )));
        }

        serde_json::from_str::<Value>(raw).map_err(|error| {
            AIError::Provider(format!(
                "Gemini Native image API returned invalid JSON ({}): {}; body={}",
                status,
                error,
                Self::response_body_excerpt(raw)
            ))
        })
    }

    async fn post_json_request(
        &self,
        endpoint: &str,
        api_key: &str,
        body: &Value,
    ) -> Result<(StatusCode, String), AIError> {
        let response = self
            .client
            .post(endpoint)
            .header("x-goog-api-key", api_key)
            .json(body)
            .send()
            .await?;
        let status = response.status();
        let raw = response.text().await.unwrap_or_default();
        Ok((status, raw))
    }

    async fn submit_request(
        &self,
        request: &GenerateRequest,
    ) -> Result<(String, StatusCode, Value), AIError> {
        let api_key = self.api_key_for_request(request).await?;
        let mut base_url = Self::normalize_base_url(Self::config_value(request, "base_url"))?;
        let model = Self::resolve_model(request)?;
        let mut endpoint = Self::generate_content_endpoint(base_url.as_str(), model.as_str());
        let body = self.build_request_body(request).await?;

        info!(
            "[Gemini Native Image] request model={}, endpoint={}, refs={}, size={}, aspect_ratio={}",
            model,
            endpoint,
            request.reference_images.as_ref().map(Vec::len).unwrap_or(0),
            request.size,
            request.aspect_ratio
        );

        let (mut status, mut raw) = self
            .post_json_request(endpoint.as_str(), api_key.as_str(), &body)
            .await?;

        // An OpenAI-compatible /v1 URL can remain after switching a custom provider
        // to Gemini Native. Retry only the gateway's missing HTML route at /v1beta.
        if Self::is_html_not_found(status, raw.as_str()) {
            if let Some(fallback_base_url) = Self::fallback_v1beta_base_url(base_url.as_str()) {
                let fallback_endpoint =
                    Self::generate_content_endpoint(fallback_base_url.as_str(), model.as_str());
                info!(
                    "[Gemini Native Image] retrying missing /v1 route at {}",
                    fallback_endpoint
                );
                let (fallback_status, fallback_raw) = self
                    .post_json_request(fallback_endpoint.as_str(), api_key.as_str(), &body)
                    .await?;
                base_url = fallback_base_url;
                endpoint = fallback_endpoint;
                status = fallback_status;
                raw = fallback_raw;
            }
        }

        let body = Self::parse_submit_response(endpoint.as_str(), status, raw.as_str())?;
        Ok((base_url, status, body))
    }

    async fn poll_task_with_api_key(
        &self,
        handle: ProviderTaskHandle,
        api_key: &str,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let base_url = Self::normalize_base_url(Self::metadata_base_url(&handle))?;
        let fallback_status_url = format!(
            "/v1/images/tasks/{}?view=summary",
            urlencoding::encode(handle.task_id.as_str())
        );
        let endpoint = Self::metadata_status_url(&handle)
            .map(|status_url| Self::resolve_endpoint(&base_url, &status_url))
            .unwrap_or_else(|| Self::resolve_endpoint(&base_url, &fallback_status_url));

        let response = self
            .client
            .get(&endpoint)
            .header("x-goog-api-key", api_key)
            .send()
            .await?;
        let status = response.status();
        let raw = response.text().await.unwrap_or_default();
        let body = serde_json::from_str::<Value>(&raw).map_err(|error| {
            AIError::Provider(format!(
                "Gemini Native image task poll returned invalid JSON ({}): {}; body={}",
                status, error, raw
            ))
        })?;
        if !status.is_success() {
            return Err(AIError::Provider(format!(
                "Gemini Native image task poll returned {}: {}",
                status,
                Self::response_error_message(&body)
            )));
        }

        if let Some(image_source) = Self::response_image_source(&body) {
            return Ok(ProviderTaskPollResult::Succeeded(image_source));
        }

        match body
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "failed" | "cancelled" | "canceled" => Ok(ProviderTaskPollResult::Failed(
                Self::response_error_message(&body),
            )),
            "succeeded" | "success" | "completed" | "finished" => Err(AIError::Provider(
                "Completed Gemini Native image task did not include an image asset".to_string(),
            )),
            _ => Ok(ProviderTaskPollResult::Running),
        }
    }
}

impl Default for GeminiNativeImageProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl AIProvider for GeminiNativeImageProvider {
    fn name(&self) -> &str {
        GEMINI_NATIVE_PROVIDER_ID
    }

    fn supports_model(&self, model: &str) -> bool {
        model
            .strip_prefix("gemini/")
            .is_some_and(|value| !value.trim().is_empty())
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), AIError> {
        let mut stored_key = self.api_key.write().await;
        let trimmed = api_key.trim();
        *stored_key = (!trimmed.is_empty()).then(|| trimmed.to_string());
        Ok(())
    }

    fn supports_task_resume(&self) -> bool {
        true
    }

    async fn submit_task(
        &self,
        request: GenerateRequest,
    ) -> Result<ProviderTaskSubmission, AIError> {
        let (base_url, status, body) = self.submit_request(&request).await?;

        if let Some(image_source) = Self::response_image_source(&body) {
            return Ok(ProviderTaskSubmission::Succeeded(image_source));
        }

        if status == StatusCode::ACCEPTED || Self::response_task_id(&body).is_some() {
            let task_id = Self::response_task_id(&body).ok_or_else(|| {
                AIError::Provider("Gemini Native image task receipt is missing task_id".to_string())
            })?;
            return Ok(ProviderTaskSubmission::Queued(ProviderTaskHandle {
                task_id,
                metadata: Some(json!({
                    "base_url": base_url,
                    "status_url": Self::task_status_url(&body),
                })),
            }));
        }

        Err(AIError::Provider(
            "Gemini Native image API response did not include candidates[].content.parts[].inlineData or a task id"
                .to_string(),
        ))
    }

    async fn poll_task(
        &self,
        handle: ProviderTaskHandle,
    ) -> Result<ProviderTaskPollResult, AIError> {
        let api_key = self.configured_api_key().await?;
        self.poll_task_with_api_key(handle, api_key.as_str()).await
    }

    async fn generate(&self, request: GenerateRequest) -> Result<String, AIError> {
        let api_key = self.api_key_for_request(&request).await?;
        match self.submit_task(request).await? {
            ProviderTaskSubmission::Succeeded(image_source) => Ok(image_source),
            ProviderTaskSubmission::Queued(handle) => {
                for _ in 0..MAX_SYNC_POLL_ATTEMPTS {
                    sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
                    match self.poll_task_with_api_key(handle.clone(), api_key.as_str()).await? {
                        ProviderTaskPollResult::Running => continue,
                        ProviderTaskPollResult::Succeeded(image_source) => return Ok(image_source),
                        ProviderTaskPollResult::SucceededWithMeta { url, .. } => return Ok(url),
                        ProviderTaskPollResult::Failed(message) => {
                            return Err(AIError::TaskFailed(message));
                        }
                    }
                }
                Err(AIError::TaskFailed(
                    "Timed out waiting for Gemini Native image task".to_string(),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::GeminiNativeImageProvider;
    use crate::ai::{AIProvider, GenerateRequest, ProviderTaskPollResult, ProviderTaskSubmission};
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    fn generate_request(base_url: &str, references: Option<Vec<String>>) -> GenerateRequest {
        GenerateRequest {
            prompt: "design a character".to_string(),
            model: "gemini/gemini-3-pro-image-preview".to_string(),
            size: "4K".to_string(),
            aspect_ratio: "4:3".to_string(),
            reference_images: references,
            extra_params: None,
            provider_config: Some(HashMap::from([
                ("base_url".to_string(), json!(base_url)),
                ("api_key".to_string(), json!("test-key")),
            ])),
            draft_task_id: None,
        }
    }

    async fn read_http_request(socket: &mut TcpStream) -> Vec<u8> {
        let mut request_bytes = Vec::new();
        let mut buffer = [0_u8; 4096];
        let (header_end, content_length) = loop {
            let bytes_read = socket.read(&mut buffer).await.unwrap();
            assert!(bytes_read > 0, "connection closed before request headers");
            request_bytes.extend_from_slice(&buffer[..bytes_read]);

            if let Some(header_end) = request_bytes
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
            {
                let headers = String::from_utf8_lossy(&request_bytes[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                break (header_end + 4, content_length);
            }
        };

        while request_bytes.len() < header_end + content_length {
            let bytes_read = socket.read(&mut buffer).await.unwrap();
            assert!(bytes_read > 0, "connection closed before request body");
            request_bytes.extend_from_slice(&buffer[..bytes_read]);
        }

        request_bytes
    }

    async fn write_json_response(socket: &mut TcpStream, status: &str, body: &str) {
        socket
            .write_all(
                format!(
                    "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    body.len(),
                    body
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    }

    async fn write_html_response(socket: &mut TcpStream, status: &str, body: &str) {
        socket
            .write_all(
                format!(
                    "HTTP/1.1 {}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    body.len(),
                    body
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn builds_native_request_with_inline_reference_images() {
        let provider = GeminiNativeImageProvider::new();
        let request = generate_request(
            "https://gateway.example/v1beta",
            Some(vec!["data:image/png;base64,iVBORw0KGgo=".to_string()]),
        );

        let body = provider.build_request_body(&request).await.unwrap();
        let parts = body
            .pointer("/contents/0/parts")
            .and_then(Value::as_array)
            .unwrap();

        assert_eq!(parts[0], json!({ "text": "design a character" }));
        assert_eq!(parts[1], json!({
            "inlineData": {
                "mimeType": "image/png",
                "data": "iVBORw0KGgo=",
            }
        }));
        assert_eq!(
            body.pointer("/generationConfig/imageConfig/aspectRatio")
                .and_then(Value::as_str),
            Some("4:3")
        );
        assert_eq!(
            body.pointer("/generationConfig/imageConfig/imageSize")
                .and_then(Value::as_str),
            Some("4K")
        );
    }

    #[tokio::test]
    async fn uses_gemini_endpoint_and_header_then_reads_inline_image_data() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request_bytes = Vec::new();
            let mut buffer = [0_u8; 4096];
            let (header_end, content_length) = loop {
                let bytes_read = socket.read(&mut buffer).await.unwrap();
                assert!(bytes_read > 0, "connection closed before request headers");
                request_bytes.extend_from_slice(&buffer[..bytes_read]);

                if let Some(header_end) = request_bytes
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                {
                    let headers = String::from_utf8_lossy(&request_bytes[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .expect("JSON request should include content-length");
                    break (header_end + 4, content_length);
                }
            };

            while request_bytes.len() < header_end + content_length {
                let bytes_read = socket.read(&mut buffer).await.unwrap();
                assert!(bytes_read > 0, "connection closed before request body");
                request_bytes.extend_from_slice(&buffer[..bytes_read]);
            }

            let response = r#"{"candidates":[{"content":{"parts":[{"text":"done"},{"inlineData":{"mimeType":"image/webp","data":"AQID"}}]}}]}"#;
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        response.len(),
                        response
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            request_bytes
        });

        let provider = GeminiNativeImageProvider::new();
        let source = provider
            .generate(generate_request(
                format!("http://{address}/v1beta").as_str(),
                None,
            ))
            .await
            .unwrap();

        assert_eq!(source, "data:image/webp;base64,AQID");
        let request_bytes = server.await.unwrap();
        let request = String::from_utf8_lossy(&request_bytes);
        let normalized_headers = request.to_ascii_lowercase();
        assert!(request.starts_with(
            "POST /v1beta/models/gemini-3-pro-image-preview:generateContent HTTP/1.1"
        ));
        assert!(normalized_headers.contains("x-goog-api-key: test-key"));
        assert!(!normalized_headers.contains("authorization:"));
        assert!(request.contains("\"responseModalities\":[\"TEXT\",\"IMAGE\"]"));
    }

    #[tokio::test]
    async fn retries_a_missing_html_v1_route_at_v1beta() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut first_socket, _) = listener.accept().await.unwrap();
            let first_request = read_http_request(&mut first_socket).await;
            write_html_response(
                &mut first_socket,
                "404 Not Found",
                "<html><body>not found</body></html>",
            )
            .await;
            drop(first_socket);

            let (mut second_socket, _) = listener.accept().await.unwrap();
            let second_request = read_http_request(&mut second_socket).await;
            let receipt = r#"{"object":"media_task","id":"imgtask-456","task_id":"imgtask-456","status":"queued","execution_mode":"async","status_url":"/v1/images/tasks/imgtask-456?view=summary"}"#;
            write_json_response(&mut second_socket, "202 Accepted", receipt).await;

            (first_request, second_request)
        });

        let provider = GeminiNativeImageProvider::new();
        let submission = provider
            .submit_task(generate_request(
                format!("http://{address}/v1").as_str(),
                None,
            ))
            .await
            .unwrap();

        let handle = match submission {
            ProviderTaskSubmission::Queued(handle) => handle,
            ProviderTaskSubmission::Succeeded(_) => panic!("expected queued task receipt"),
        };
        let expected_base_url = format!("http://{address}/v1beta");
        assert_eq!(
            handle
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("base_url"))
                .and_then(Value::as_str),
            Some(expected_base_url.as_str())
        );

        let (first_request, second_request) = server.await.unwrap();
        let first_request = String::from_utf8_lossy(&first_request);
        let second_request = String::from_utf8_lossy(&second_request);
        assert!(first_request.starts_with(
            "POST /v1/models/gemini-3-pro-image-preview:generateContent HTTP/1.1"
        ));
        assert!(second_request.starts_with(
            "POST /v1beta/models/gemini-3-pro-image-preview:generateContent HTTP/1.1"
        ));
    }

    #[tokio::test]
    async fn submits_and_polls_gateway_wrapped_async_tasks() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut submit_socket, _) = listener.accept().await.unwrap();
            let submit_request = read_http_request(&mut submit_socket).await;
            let receipt = r#"{"object":"media_task","id":"imgtask-123","task_id":"imgtask-123","status":"queued","execution_mode":"async","status_url":"/v1/images/tasks/imgtask-123?view=summary"}"#;
            write_json_response(&mut submit_socket, "202 Accepted", receipt).await;
            drop(submit_socket);

            let (mut poll_socket, _) = listener.accept().await.unwrap();
            let poll_request = read_http_request(&mut poll_socket).await;
            let completed = r#"{"id":"imgtask-123","status":"succeeded","assets":[{"signed_url":"https://assets.example/generated.png"}]}"#;
            write_json_response(&mut poll_socket, "200 OK", completed).await;

            (submit_request, poll_request)
        });

        let provider = GeminiNativeImageProvider::new();
        provider.set_api_key("test-key".to_string()).await.unwrap();
        let submission = provider
            .submit_task(generate_request(
                format!("http://{address}/v1beta").as_str(),
                None,
            ))
            .await
            .unwrap();
        let handle = match submission {
            ProviderTaskSubmission::Queued(handle) => handle,
            ProviderTaskSubmission::Succeeded(_) => panic!("expected queued task receipt"),
        };

        assert_eq!(handle.task_id, "imgtask-123");
        let metadata = handle.metadata.as_ref().unwrap();
        let expected_base_url = format!("http://{address}/v1beta");
        assert_eq!(
            metadata.get("base_url").and_then(Value::as_str),
            Some(expected_base_url.as_str())
        );
        assert_eq!(
            metadata.get("status_url").and_then(Value::as_str),
            Some("/v1/images/tasks/imgtask-123?view=summary")
        );
        assert!(metadata.get("api_key").is_none());

        let result = provider.poll_task(handle).await.unwrap();
        match result {
            ProviderTaskPollResult::Succeeded(source) => {
                assert_eq!(source, "https://assets.example/generated.png");
            }
            _ => panic!("expected signed image URL from completed task"),
        }

        let (submit_request, poll_request) = server.await.unwrap();
        let submit_request = String::from_utf8_lossy(&submit_request);
        let poll_request = String::from_utf8_lossy(&poll_request);
        let submit_headers = submit_request.to_ascii_lowercase();
        let poll_headers = poll_request.to_ascii_lowercase();
        assert!(submit_request.starts_with(
            "POST /v1beta/models/gemini-3-pro-image-preview:generateContent HTTP/1.1"
        ));
        assert!(poll_request.starts_with(
            "GET /v1/images/tasks/imgtask-123?view=summary HTTP/1.1"
        ));
        assert!(submit_headers.contains("x-goog-api-key: test-key"));
        assert!(poll_headers.contains("x-goog-api-key: test-key"));
        assert!(!submit_headers.contains("authorization:"));
        assert!(!poll_headers.contains("authorization:"));
    }
}
