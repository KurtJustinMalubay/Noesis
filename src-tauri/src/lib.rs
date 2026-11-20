use std::{collections::HashMap, time::Duration};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize)]
struct LocalAiResponse {
    status: u16,
    status_text: String,
    body: String,
}

fn validate_local_ai_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed_url = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("Local AI endpoint must use HTTP or HTTPS.".to_string());
    }
    Ok(parsed_url)
}

fn add_headers(
    mut request: reqwest::RequestBuilder,
    headers: HashMap<String, String>,
) -> Result<reqwest::RequestBuilder, String> {
    for (name, value) in headers {
        let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("Invalid request header name: {error}"))?;
        let header_value = reqwest::header::HeaderValue::from_bytes(value.as_bytes())
            .map_err(|error| format!("Invalid request header value: {error}"))?;
        request = request.header(header_name, header_value);
    }
    Ok(request)
}

fn find_sse_frame_end(buffer: &[u8]) -> Option<(usize, usize)> {
    for (index, byte) in buffer.iter().enumerate() {
        if *byte == b'\n' && buffer.get(index + 1) == Some(&b'\n') {
            return Some((index, 2));
        }
        if buffer
            .get(index..index + 4)
            .map(|frame| frame == b"\r\n\r\n")
            .unwrap_or(false)
        {
            return Some((index, 4));
        }
    }
    None
}

fn emit_sse_frame(frame: &[u8], channel: &Channel<String>) -> Result<(), String> {
    let text = String::from_utf8_lossy(frame);
    let data = text
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n");
    if !data.is_empty() {
        channel
            .send(data)
            .map_err(|error| format!("Could not forward local AI stream chunk: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn local_ai_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<LocalAiResponse, String> {
    let parsed_url = validate_local_ai_url(&url)?;
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("Unsupported local AI request method: {error}"))?;
    if method != reqwest::Method::GET && method != reqwest::Method::POST {
        return Err("Only GET and POST are supported for local AI requests.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("Could not create the local AI HTTP client: {error}"))?;
    let mut request = add_headers(client.request(method, parsed_url), headers)?;
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Local AI endpoint request failed: {error}"))?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Could not read the local AI response: {error}"))?;

    Ok(LocalAiResponse {
        status: status.as_u16(),
        status_text,
        body,
    })
}

#[tauri::command]
async fn local_ai_stream(
    url: String,
    headers: HashMap<String, String>,
    body: String,
    on_event: Channel<String>,
) -> Result<LocalAiResponse, String> {
    let parsed_url = validate_local_ai_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("Could not create the local AI HTTP client: {error}"))?;
    let request = add_headers(client.post(parsed_url).body(body), headers)?;
    let response = request
        .send()
        .await
        .map_err(|error| format!("Local AI streaming request failed: {error}"))?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .map_err(|error| format!("Could not read the local AI error response: {error}"))?;
        return Ok(LocalAiResponse {
            status: status.as_u16(),
            status_text,
            body,
        });
    }

    let mut response_stream = response.bytes_stream();
    let mut pending = Vec::new();
    let mut complete_body = Vec::new();
    while let Some(chunk) = response_stream.next().await {
        let chunk = chunk.map_err(|error| format!("Local AI stream failed: {error}"))?;
        pending.extend_from_slice(&chunk);
        complete_body.extend_from_slice(&chunk);
        while let Some((frame_end, delimiter_length)) = find_sse_frame_end(&pending) {
            let frame = pending
                .drain(..frame_end + delimiter_length)
                .collect::<Vec<_>>();
            emit_sse_frame(&frame, &on_event)?;
        }
    }
    if !pending.is_empty() {
        emit_sse_frame(&pending, &on_event)?;
    }

    Ok(LocalAiResponse {
        status: status.as_u16(),
        status_text,
        body: String::from_utf8_lossy(&complete_body).into_owned(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            greet,
            local_ai_request,
            local_ai_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
