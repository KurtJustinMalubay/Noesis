use std::{collections::HashMap, time::Duration};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, ipc::Channel};
use tauri_plugin_sql::{DbInstances, DbPool};

mod store_distribution;

const LOCAL_AI_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_LOCAL_AI_BODY_BYTES: usize = 32 * 1024 * 1024;
const MAX_SSE_FRAME_BYTES: usize = 1024 * 1024;

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

#[derive(Deserialize)]
struct GeneratedWorkspace {
    id: String,
    title: String,
    root_domain: String,
    layout_mode: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
struct GeneratedNode {
    id: String,
    workspace_id: String,
    title: String,
    summary_hint: String,
    status: String,
    mastery_score: f64,
    in_degree_unmastered: i64,
    layer_index: i64,
    pos_x: f64,
    pos_y: f64,
    is_hydrated: i64,
    lesson_markdown: Option<String>,
    mermaid_diagram: Option<String>,
    source_citations: Option<String>,
    updated_at: i64,
}

#[derive(Deserialize)]
struct GeneratedEdge {
    workspace_id: String,
    source_id: String,
    target_id: String,
}

async fn get_sqlite_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let instances = app.state::<DbInstances>();
    let databases = instances.0.read().await;
    match databases.get("sqlite:noesis.db") {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        None => Err("The local Noesis database is not loaded.".to_string()),
    }
}

async fn persist_generated_workspace(
    pool: &SqlitePool,
    workspace: &GeneratedWorkspace,
    nodes: &[GeneratedNode],
    edges: &[GeneratedEdge],
) -> Result<(), String> {
    if nodes.is_empty()
        || nodes.iter().any(|node| node.workspace_id != workspace.id)
        || edges.iter().any(|edge| {
            edge.workspace_id != workspace.id
                || !nodes.iter().any(|node| node.id == edge.source_id)
                || !nodes.iter().any(|node| node.id == edge.target_id)
        })
    {
        return Err("The generated workspace graph is inconsistent.".to_string());
    }

    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let save_result: Result<(), sqlx::Error> = async {
        sqlx::query(
            r#"INSERT INTO workspaces
               (id, title, root_domain, layout_mode, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&workspace.id)
        .bind(&workspace.title)
        .bind(&workspace.root_domain)
        .bind(&workspace.layout_mode)
        .bind(workspace.created_at)
        .bind(workspace.updated_at)
        .execute(&mut *transaction)
        .await?;

        for node in nodes {
            sqlx::query(
                r#"INSERT INTO nodes (
                   id, workspace_id, title, summary_hint, status, mastery_score,
                   in_degree_unmastered, layer_index, pos_x, pos_y, is_hydrated,
                   lesson_markdown, mermaid_diagram, source_citations, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            )
            .bind(&node.id)
            .bind(&node.workspace_id)
            .bind(&node.title)
            .bind(&node.summary_hint)
            .bind(&node.status)
            .bind(node.mastery_score)
            .bind(node.in_degree_unmastered)
            .bind(node.layer_index)
            .bind(node.pos_x)
            .bind(node.pos_y)
            .bind(node.is_hydrated)
            .bind(&node.lesson_markdown)
            .bind(&node.mermaid_diagram)
            .bind(&node.source_citations)
            .bind(node.updated_at)
            .execute(&mut *transaction)
            .await?;
        }

        for edge in edges {
            sqlx::query("INSERT INTO edges (workspace_id, source_id, target_id) VALUES (?, ?, ?)")
                .bind(&edge.workspace_id)
                .bind(&edge.source_id)
                .bind(&edge.target_id)
                .execute(&mut *transaction)
                .await?;
        }

        Ok(())
    }
    .await;

    if let Err(error) = save_result {
        return match transaction.rollback().await {
            Ok(()) => Err(format!("Could not save generated workspace: {error}")),
            Err(rollback_error) => Err(format!(
                "Could not save generated workspace ({error}) and rollback failed ({rollback_error})."
            )),
        };
    }

    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit generated workspace: {error}"))
}

async fn remove_generated_workspace(pool: &SqlitePool, workspace_id: &str) -> Result<(), String> {
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let delete_result: Result<(), sqlx::Error> = async {
        sqlx::query("DELETE FROM edges WHERE workspace_id = ?")
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM nodes WHERE workspace_id = ?")
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM workspaces WHERE id = ?")
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await?;
        Ok(())
    }
    .await;

    if let Err(error) = delete_result {
        return match transaction.rollback().await {
            Ok(()) => Err(format!("Could not remove cancelled workspace: {error}")),
            Err(rollback_error) => Err(format!(
                "Could not remove cancelled workspace ({error}) and rollback failed ({rollback_error})."
            )),
        };
    }

    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit workspace cleanup: {error}"))
}

#[tauri::command]
async fn save_generated_workspace(
    app: AppHandle,
    workspace: GeneratedWorkspace,
    nodes: Vec<GeneratedNode>,
    edges: Vec<GeneratedEdge>,
) -> Result<(), String> {
    let pool = get_sqlite_pool(&app).await?;
    persist_generated_workspace(&pool, &workspace, &nodes, &edges).await
}

#[tauri::command]
async fn delete_generated_workspace(app: AppHandle, workspace_id: String) -> Result<(), String> {
    let pool = get_sqlite_pool(&app).await?;
    remove_generated_workspace(&pool, &workspace_id).await
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

async fn read_limited_response_body(response: reqwest::Response) -> Result<String, String> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|error| format!("Could not read the local AI response: {error}"))?;
        if body.len().saturating_add(chunk.len()) > MAX_LOCAL_AI_BODY_BYTES {
            return Err("Local AI response exceeded the 32 MiB safety limit.".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

#[tauri::command]
async fn local_ai_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<LocalAiResponse, String> {
    if body
        .as_ref()
        .map(|body| body.len() > MAX_LOCAL_AI_BODY_BYTES)
        .unwrap_or(false)
    {
        return Err("Local AI request exceeded the 32 MiB safety limit.".to_string());
    }
    let parsed_url = validate_local_ai_url(&url)?;
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("Unsupported local AI request method: {error}"))?;
    if method != reqwest::Method::GET && method != reqwest::Method::POST {
        return Err("Only GET and POST are supported for local AI requests.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(LOCAL_AI_TIMEOUT)
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
    let body = read_limited_response_body(response).await?;

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
    if body.len() > MAX_LOCAL_AI_BODY_BYTES {
        return Err("Local AI request exceeded the 32 MiB safety limit.".to_string());
    }
    let parsed_url = validate_local_ai_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(LOCAL_AI_TIMEOUT)
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
        let body = read_limited_response_body(response).await?;
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
        if complete_body.len().saturating_add(chunk.len()) > MAX_LOCAL_AI_BODY_BYTES {
            return Err("Local AI stream exceeded the 32 MiB safety limit.".to_string());
        }
        pending.extend_from_slice(&chunk);
        complete_body.extend_from_slice(&chunk);
        while let Some((frame_end, delimiter_length)) = find_sse_frame_end(&pending) {
            let frame = pending
                .drain(..frame_end + delimiter_length)
                .collect::<Vec<_>>();
            emit_sse_frame(&frame, &on_event)?;
        }
        if pending.len() > MAX_SSE_FRAME_BYTES {
            return Err("Local AI stream contained an oversized event frame.".to_string());
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
            save_generated_workspace,
            delete_generated_workspace,
            local_ai_request,
            local_ai_stream,
            store_distribution::is_microsoft_store_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn test_workspace() -> GeneratedWorkspace {
        GeneratedWorkspace {
            id: "workspace-1".to_string(),
            title: "Test workspace".to_string(),
            root_domain: "Test".to_string(),
            layout_mode: "auto".to_string(),
            created_at: 1,
            updated_at: 1,
        }
    }

    fn test_node(workspace_id: &str) -> GeneratedNode {
        GeneratedNode {
            id: "node-1".to_string(),
            workspace_id: workspace_id.to_string(),
            title: "Test node".to_string(),
            summary_hint: "Test summary".to_string(),
            status: "unlocked".to_string(),
            mastery_score: 0.0,
            in_degree_unmastered: 0,
            layer_index: 0,
            pos_x: 0.0,
            pos_y: 0.0,
            is_hydrated: 0,
            lesson_markdown: None,
            mermaid_diagram: None,
            source_citations: None,
            updated_at: 1,
        }
    }

    #[test]
    fn generated_workspace_saves_atomically_and_can_be_removed() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("in-memory database should open");
            sqlx::query("PRAGMA foreign_keys = ON")
                .execute(&pool)
                .await
                .expect("foreign keys should enable");
            sqlx::query(
                "CREATE TABLE workspaces (
                   id TEXT PRIMARY KEY, title TEXT NOT NULL, root_domain TEXT NOT NULL,
                   layout_mode TEXT NOT NULL, created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 )",
            )
            .execute(&pool)
            .await
            .expect("workspace schema should create");
            sqlx::query(
                "CREATE TABLE nodes (
                   id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                   title TEXT NOT NULL, summary_hint TEXT NOT NULL, status TEXT NOT NULL,
                   mastery_score REAL NOT NULL, in_degree_unmastered INTEGER NOT NULL,
                   layer_index INTEGER NOT NULL, pos_x REAL NOT NULL, pos_y REAL NOT NULL,
                   is_hydrated INTEGER NOT NULL, lesson_markdown TEXT, mermaid_diagram TEXT,
                   source_citations TEXT, updated_at INTEGER NOT NULL
                 )",
            )
            .execute(&pool)
            .await
            .expect("node schema should create");
            sqlx::query(
                "CREATE TABLE edges (
                   workspace_id TEXT NOT NULL REFERENCES workspaces(id),
                   source_id TEXT NOT NULL REFERENCES nodes(id),
                   target_id TEXT NOT NULL REFERENCES nodes(id),
                   PRIMARY KEY (source_id, target_id)
                 )",
            )
            .execute(&pool)
            .await
            .expect("edge schema should create");

            let workspace = test_workspace();
            let node = test_node(&workspace.id);
            let node_id = node.id.clone();
            persist_generated_workspace(&pool, &workspace, &[node], &[])
                .await
                .expect("valid workspace graph should save");
            let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM nodes WHERE workspace_id = ?")
                .bind(&workspace.id)
                .fetch_one(&pool)
                .await
                .expect("saved node count should be readable");
            assert_eq!(count.0, 1);

            remove_generated_workspace(&pool, &workspace.id)
                .await
                .expect("workspace cleanup should succeed");
            let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM workspaces WHERE id = ?")
                .bind(&workspace.id)
                .fetch_one(&pool)
                .await
                .expect("workspace count should be readable");
            assert_eq!(count.0, 0);
            let graph_counts: (i64, i64) = sqlx::query_as(
                "SELECT
                   (SELECT COUNT(*) FROM nodes WHERE workspace_id = ?),
                   (SELECT COUNT(*) FROM edges WHERE workspace_id = ?)",
            )
            .bind(&workspace.id)
            .bind(&workspace.id)
            .fetch_one(&pool)
            .await
            .expect("graph counts should be readable after cleanup");
            assert_eq!(graph_counts, (0, 0));

            let duplicate_edges = [
                GeneratedEdge {
                    workspace_id: workspace.id.clone(),
                    source_id: node_id.clone(),
                    target_id: node_id.clone(),
                },
                GeneratedEdge {
                    workspace_id: workspace.id.clone(),
                    source_id: node_id.clone(),
                    target_id: node_id,
                },
            ];
            let failed_node = test_node(&workspace.id);
            assert!(
                persist_generated_workspace(&pool, &workspace, &[failed_node], &duplicate_edges)
                    .await
                    .is_err(),
                "duplicate edges should fail the transaction"
            );
            let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM workspaces WHERE id = ?")
                .bind(&workspace.id)
                .fetch_one(&pool)
                .await
                .expect("workspace count should be readable after rollback");
            assert_eq!(count.0, 0, "failed graph save must roll back its workspace");
            let graph_counts: (i64, i64) = sqlx::query_as(
                "SELECT
                   (SELECT COUNT(*) FROM nodes WHERE workspace_id = ?),
                   (SELECT COUNT(*) FROM edges WHERE workspace_id = ?)",
            )
            .bind(&workspace.id)
            .bind(&workspace.id)
            .fetch_one(&pool)
            .await
            .expect("graph counts should be readable after rollback");
            assert_eq!(graph_counts, (0, 0));
        });
    }
}
