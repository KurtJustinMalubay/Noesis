use std::{
    collections::{HashMap, HashSet},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sqlx::{Sqlite, SqlitePool, Transaction};
use tauri::{ipc::Channel, AppHandle, Manager};
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

#[derive(Deserialize)]
struct CurriculumTreeRecord {
    id: String,
    title: String,
    layout_mode: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
struct CurriculumTreeNodeRecord {
    id: String,
    tree_id: String,
    workspace_id: Option<String>,
    title: String,
    summary_hint: String,
    layer_index: i64,
    pos_x: f64,
    pos_y: f64,
}

#[derive(Deserialize)]
struct CurriculumTreeEdgeRecord {
    tree_id: String,
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

async fn rollback_transaction(
    transaction: Transaction<'_, Sqlite>,
    context: &str,
    cause: String,
) -> String {
    match transaction.rollback().await {
        Ok(()) => format!("{context}: {cause}"),
        Err(rollback_error) => {
            format!("{context}: {cause}; rollback also failed: {rollback_error}")
        }
    }
}

fn validate_curriculum_tree_graph(
    tree_id: &str,
    nodes: &[CurriculumTreeNodeRecord],
    edges: &[CurriculumTreeEdgeRecord],
) -> Result<HashSet<String>, String> {
    let node_ids: HashSet<String> = nodes.iter().map(|node| node.id.clone()).collect();
    if node_ids.len() != nodes.len()
        || nodes.iter().any(|node| node.tree_id != tree_id)
        || edges.iter().any(|edge| {
            edge.tree_id != tree_id
                || !node_ids.contains(&edge.source_id)
                || !node_ids.contains(&edge.target_id)
        })
    {
        return Err("The curriculum map graph is inconsistent.".to_string());
    }
    Ok(node_ids)
}

fn current_time_millis() -> Result<i64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    i64::try_from(millis).map_err(|error| error.to_string())
}

async fn persist_curriculum_tree(
    pool: &SqlitePool,
    tree: &CurriculumTreeRecord,
    nodes: &[CurriculumTreeNodeRecord],
    edges: &[CurriculumTreeEdgeRecord],
) -> Result<(), String> {
    validate_curriculum_tree_graph(&tree.id, nodes, edges)?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let result: Result<(), String> = async {
        sqlx::query(
            "INSERT INTO curriculum_trees (id, title, layout_mode, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, NULL)",
        )
        .bind(&tree.id)
        .bind(&tree.title)
        .bind(&tree.layout_mode)
        .bind(tree.created_at)
        .bind(tree.updated_at)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;

        for node in nodes {
            sqlx::query(
                "INSERT INTO curriculum_tree_nodes (id, tree_id, workspace_id, title, summary_hint, layer_index, pos_x, pos_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&node.id)
            .bind(&tree.id)
            .bind(&node.workspace_id)
            .bind(&node.title)
            .bind(&node.summary_hint)
            .bind(node.layer_index)
            .bind(node.pos_x)
            .bind(node.pos_y)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        }
        for edge in edges {
            sqlx::query(
                "INSERT INTO curriculum_tree_edges (tree_id, source_id, target_id) VALUES (?, ?, ?)",
            )
            .bind(&tree.id)
            .bind(&edge.source_id)
            .bind(&edge.target_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        }
        Ok(())
    }
    .await;

    if let Err(error) = result {
        return Err(
            rollback_transaction(transaction, "Could not create curriculum map", error).await,
        );
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit curriculum map: {error}"))
}

async fn remove_curriculum_tree_and_linked_workspaces(
    pool: &SqlitePool,
    tree_id: &str,
) -> Result<Vec<String>, String> {
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let result: Result<Vec<String>, String> = async {
        let linked_workspaces: Vec<(String, String, Option<i64>)> = sqlx::query_as(
            "SELECT DISTINCT workspaces.id, workspaces.title, workspaces.archived_at
             FROM curriculum_tree_nodes
             JOIN workspaces ON workspaces.id = curriculum_tree_nodes.workspace_id
             WHERE curriculum_tree_nodes.tree_id = ?",
        )
        .bind(tree_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;

        let unarchived: Vec<&(String, String, Option<i64>)> = linked_workspaces
            .iter()
            .filter(|workspace| workspace.2.is_none())
            .collect();
        if !unarchived.is_empty() {
            let titles = unarchived
                .iter()
                .map(|workspace| format!("\"{}\"", workspace.1))
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!(
                "Archive linked workspace{} {} before permanently deleting them.",
                if unarchived.len() == 1 { "" } else { "s" },
                titles
            ));
        }

        let workspace_ids: Vec<String> = linked_workspaces
            .iter()
            .map(|workspace| workspace.0.clone())
            .collect();
        let deleted_tree = sqlx::query("DELETE FROM curriculum_trees WHERE id = ?")
            .bind(tree_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        if deleted_tree.rows_affected() == 0 {
            return Err("The curriculum map is no longer available.".to_string());
        }

        for workspace_id in &workspace_ids {
            let deleted_workspace = sqlx::query(
                "DELETE FROM workspaces WHERE id = ? AND archived_at IS NOT NULL",
            )
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
            if deleted_workspace.rows_affected() == 0 {
                return Err(
                    "A linked workspace could not be permanently deleted because it is no longer archived."
                        .to_string(),
                );
            }
        }
        Ok(workspace_ids)
    }
    .await;

    let workspace_ids = match result {
        Ok(workspace_ids) => workspace_ids,
        Err(error) => {
            return Err(rollback_transaction(
                transaction,
                "Could not permanently delete curriculum map",
                error,
            )
            .await);
        }
    };
    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit curriculum map deletion: {error}"))?;
    Ok(workspace_ids)
}

async fn restore_workspace_graph_snapshot_transaction(
    pool: &SqlitePool,
    workspace_id: &str,
    target_nodes: &[GeneratedNode],
    target_edges: &[GeneratedEdge],
    current_node_ids: &[String],
    layout_mode: &str,
) -> Result<(), String> {
    let target_ids: HashSet<String> = target_nodes.iter().map(|node| node.id.clone()).collect();
    if target_ids.len() != target_nodes.len()
        || target_nodes
            .iter()
            .any(|node| node.workspace_id != workspace_id)
        || target_edges.iter().any(|edge| {
            edge.workspace_id != workspace_id
                || !target_ids.contains(&edge.source_id)
                || !target_ids.contains(&edge.target_id)
        })
    {
        return Err("The workspace graph snapshot is inconsistent.".to_string());
    }

    let current_ids: HashSet<String> = current_node_ids.iter().cloned().collect();
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let result: Result<(), String> = async {
        let now = current_time_millis()?;
        for node in target_nodes {
            if !current_ids.contains(&node.id) {
                let existing_workspace: Option<String> =
                    sqlx::query_scalar("SELECT workspace_id FROM nodes WHERE id = ?")
                        .bind(&node.id)
                        .fetch_optional(&mut *transaction)
                        .await
                        .map_err(|error| error.to_string())?;
                if let Some(existing_workspace) = existing_workspace {
                    if existing_workspace != workspace_id {
                        return Err(
                            "A concept in the history is no longer available in this workspace."
                                .to_string(),
                        );
                    }
                    sqlx::query("UPDATE nodes SET archived_at = NULL WHERE id = ?")
                        .bind(&node.id)
                        .execute(&mut *transaction)
                        .await
                        .map_err(|error| error.to_string())?;
                } else {
                    sqlx::query(
                        "INSERT INTO nodes (id, workspace_id, title, summary_hint, status, mastery_score, in_degree_unmastered, layer_index, pos_x, pos_y, is_hydrated, lesson_markdown, mermaid_diagram, source_citations, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    )
                    .bind(&node.id)
                    .bind(workspace_id)
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
                    .await
                    .map_err(|error| error.to_string())?;
                }
            }
            let updated = sqlx::query(
                "UPDATE nodes SET title = ?, summary_hint = ?, status = ?, mastery_score = ?, in_degree_unmastered = ?, layer_index = ?, pos_x = ?, pos_y = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
            )
            .bind(&node.title)
            .bind(&node.summary_hint)
            .bind(&node.status)
            .bind(node.mastery_score)
            .bind(node.in_degree_unmastered)
            .bind(node.layer_index)
            .bind(node.pos_x)
            .bind(node.pos_y)
            .bind(now)
            .bind(&node.id)
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
            if updated.rows_affected() == 0 {
                return Err("A concept in the history is no longer available.".to_string());
            }
        }

        for node_id in current_node_ids {
            if !target_ids.contains(node_id) {
                let archived = sqlx::query(
                    "UPDATE nodes SET archived_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
                )
                .bind(now)
                .bind(now)
                .bind(node_id)
                .bind(workspace_id)
                .execute(&mut *transaction)
                .await
                .map_err(|error| error.to_string())?;
                if archived.rows_affected() == 0 {
                    return Err("A concept in the current graph is no longer available.".to_string());
                }
            }
        }

        let target_edge_keys: HashSet<(String, String)> = target_edges
            .iter()
            .map(|edge| (edge.source_id.clone(), edge.target_id.clone()))
            .collect();
        let current_edges: Vec<(String, String)> = sqlx::query_as(
            "SELECT source_id, target_id FROM edges WHERE workspace_id = ?",
        )
        .bind(workspace_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
        for (source_id, target_id) in current_edges {
            if !target_edge_keys.contains(&(source_id.clone(), target_id.clone())) {
                sqlx::query(
                    "DELETE FROM edges WHERE workspace_id = ? AND source_id = ? AND target_id = ?",
                )
                .bind(workspace_id)
                .bind(source_id)
                .bind(target_id)
                .execute(&mut *transaction)
                .await
                .map_err(|error| error.to_string())?;
            }
        }
        for edge in target_edges {
            sqlx::query(
                "INSERT OR IGNORE INTO edges (workspace_id, source_id, target_id) VALUES (?, ?, ?)",
            )
            .bind(workspace_id)
            .bind(&edge.source_id)
            .bind(&edge.target_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        }
        let updated_workspace =
            sqlx::query("UPDATE workspaces SET layout_mode = ? WHERE id = ?")
            .bind(layout_mode)
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        if updated_workspace.rows_affected() == 0 {
            return Err("The workspace is no longer available.".to_string());
        }
        Ok(())
    }
    .await;

    if let Err(error) = result {
        return Err(
            rollback_transaction(transaction, "Could not restore workspace graph", error).await,
        );
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit workspace graph restore: {error}"))
}

async fn restore_curriculum_tree_graph_transaction(
    pool: &SqlitePool,
    tree_id: &str,
    nodes: &[CurriculumTreeNodeRecord],
    edges: &[CurriculumTreeEdgeRecord],
    layout_mode: &str,
) -> Result<(), String> {
    validate_curriculum_tree_graph(tree_id, nodes, edges)?;
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let result: Result<(), String> = async {
        sqlx::query("DELETE FROM curriculum_tree_edges WHERE tree_id = ?")
            .bind(tree_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        sqlx::query("DELETE FROM curriculum_tree_nodes WHERE tree_id = ?")
            .bind(tree_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        for node in nodes {
            sqlx::query(
                "INSERT INTO curriculum_tree_nodes (id, tree_id, workspace_id, title, summary_hint, layer_index, pos_x, pos_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&node.id)
            .bind(tree_id)
            .bind(&node.workspace_id)
            .bind(&node.title)
            .bind(&node.summary_hint)
            .bind(node.layer_index)
            .bind(node.pos_x)
            .bind(node.pos_y)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        }
        for edge in edges {
            sqlx::query(
                "INSERT INTO curriculum_tree_edges (tree_id, source_id, target_id) VALUES (?, ?, ?)",
            )
            .bind(tree_id)
            .bind(&edge.source_id)
            .bind(&edge.target_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        }
        let updated_tree = sqlx::query(
            "UPDATE curriculum_trees SET layout_mode = ?, updated_at = ? WHERE id = ?",
        )
        .bind(layout_mode)
        .bind(current_time_millis()?)
        .bind(tree_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
        if updated_tree.rows_affected() == 0 {
            return Err("The curriculum map is no longer available.".to_string());
        }
        Ok(())
    }
    .await;

    if let Err(error) = result {
        return Err(
            rollback_transaction(transaction, "Could not restore curriculum map", error).await,
        );
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit curriculum map restore: {error}"))
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

#[tauri::command]
async fn create_curriculum_tree(
    app: AppHandle,
    tree: CurriculumTreeRecord,
    nodes: Vec<CurriculumTreeNodeRecord>,
    edges: Vec<CurriculumTreeEdgeRecord>,
) -> Result<(), String> {
    let pool = get_sqlite_pool(&app).await?;
    persist_curriculum_tree(&pool, &tree, &nodes, &edges).await
}

#[tauri::command]
async fn delete_curriculum_tree_and_linked_workspaces(
    app: AppHandle,
    tree_id: String,
) -> Result<Vec<String>, String> {
    let pool = get_sqlite_pool(&app).await?;
    remove_curriculum_tree_and_linked_workspaces(&pool, &tree_id).await
}

#[tauri::command]
async fn restore_workspace_graph_snapshot(
    app: AppHandle,
    workspace_id: String,
    target_nodes: Vec<GeneratedNode>,
    target_edges: Vec<GeneratedEdge>,
    current_node_ids: Vec<String>,
    layout_mode: String,
) -> Result<(), String> {
    let pool = get_sqlite_pool(&app).await?;
    restore_workspace_graph_snapshot_transaction(
        &pool,
        &workspace_id,
        &target_nodes,
        &target_edges,
        &current_node_ids,
        &layout_mode,
    )
    .await
}

#[tauri::command]
async fn restore_curriculum_tree_graph(
    app: AppHandle,
    tree_id: String,
    nodes: Vec<CurriculumTreeNodeRecord>,
    edges: Vec<CurriculumTreeEdgeRecord>,
    layout_mode: String,
) -> Result<(), String> {
    let pool = get_sqlite_pool(&app).await?;
    restore_curriculum_tree_graph_transaction(&pool, &tree_id, &nodes, &edges, &layout_mode).await
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
            create_curriculum_tree,
            delete_curriculum_tree_and_linked_workspaces,
            restore_workspace_graph_snapshot,
            restore_curriculum_tree_graph,
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

    fn test_node_with_id(workspace_id: &str, id: &str, title: &str) -> GeneratedNode {
        let mut node = test_node(workspace_id);
        node.id = id.to_string();
        node.title = title.to_string();
        node
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

    #[test]
    fn workspace_graph_restore_is_atomic_and_preserves_the_original_error() {
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
                   updated_at INTEGER NOT NULL, archived_at INTEGER
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
                   source_citations TEXT, updated_at INTEGER NOT NULL, archived_at INTEGER
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
            let initial_nodes = [
                test_node_with_id(&workspace.id, "node-1", "Original"),
                test_node_with_id(&workspace.id, "node-2", "To archive"),
            ];
            persist_generated_workspace(&pool, &workspace, &initial_nodes, &[])
                .await
                .expect("initial workspace graph should save");

            let restored_node = test_node_with_id(&workspace.id, "node-1", "Restored");
            restore_workspace_graph_snapshot_transaction(
                &pool,
                &workspace.id,
                &[restored_node],
                &[],
                &["node-1".to_string(), "node-2".to_string()],
                "auto",
            )
            .await
            .expect("valid graph snapshot should restore");
            let restored_title: (String,) =
                sqlx::query_as("SELECT title FROM nodes WHERE id = 'node-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("restored node should remain available");
            assert_eq!(restored_title.0, "Restored");
            let archived_at: (Option<i64>,) =
                sqlx::query_as("SELECT archived_at FROM nodes WHERE id = 'node-2'")
                    .fetch_one(&pool)
                    .await
                    .expect("removed node should remain archived");
            assert!(archived_at.0.is_some());

            sqlx::query(
                "CREATE TRIGGER reject_test_node BEFORE INSERT ON nodes
                 WHEN NEW.title = 'Trigger failure'
                 BEGIN SELECT RAISE(ABORT, 'triggered restore failure'); END",
            )
            .execute(&pool)
            .await
            .expect("failure trigger should create");
            let changed_node = test_node_with_id(&workspace.id, "node-1", "Must roll back");
            let failed_node = test_node_with_id(&workspace.id, "failed-node", "Trigger failure");
            let error = restore_workspace_graph_snapshot_transaction(
                &pool,
                &workspace.id,
                &[changed_node, failed_node],
                &[],
                &["node-1".to_string()],
                "auto",
            )
            .await
            .expect_err("trigger failure should reject the snapshot");
            assert!(
                error.contains("triggered restore failure"),
                "the database error should be preserved: {error}"
            );
            let restored_title: (String,) =
                sqlx::query_as("SELECT title FROM nodes WHERE id = 'node-1'")
                    .fetch_one(&pool)
                    .await
                    .expect("previous node state should remain available");
            assert_eq!(restored_title.0, "Restored");
            let failed_count: (i64,) =
                sqlx::query_as("SELECT COUNT(*) FROM nodes WHERE id = 'failed-node'")
                    .fetch_one(&pool)
                    .await
                    .expect("failed insert should be queryable");
            assert_eq!(failed_count.0, 0);
        });
    }

    #[test]
    fn curriculum_tree_restore_is_atomic() {
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
                   id TEXT PRIMARY KEY, title TEXT NOT NULL, archived_at INTEGER
                 )",
            )
            .execute(&pool)
            .await
            .expect("workspace schema should create");
            sqlx::query(
                "INSERT INTO workspaces (id, title, archived_at)
                 VALUES ('workspace-1', 'Linked workspace', NULL)",
            )
            .execute(&pool)
            .await
            .expect("linked workspace should create");
            sqlx::query(
                "CREATE TABLE curriculum_trees (
                   id TEXT PRIMARY KEY, title TEXT NOT NULL, layout_mode TEXT NOT NULL,
                   created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER
                 )",
            )
            .execute(&pool)
            .await
            .expect("curriculum tree schema should create");
            sqlx::query(
                "CREATE TABLE curriculum_tree_nodes (
                   id TEXT PRIMARY KEY,
                   tree_id TEXT NOT NULL REFERENCES curriculum_trees(id) ON DELETE CASCADE,
                   workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
                   title TEXT NOT NULL, summary_hint TEXT NOT NULL,
                   layer_index INTEGER NOT NULL, pos_x REAL NOT NULL, pos_y REAL NOT NULL
                 )",
            )
            .execute(&pool)
            .await
            .expect("curriculum node schema should create");
            sqlx::query(
                "CREATE TABLE curriculum_tree_edges (
                   tree_id TEXT NOT NULL REFERENCES curriculum_trees(id) ON DELETE CASCADE,
                   source_id TEXT NOT NULL REFERENCES curriculum_tree_nodes(id) ON DELETE CASCADE,
                   target_id TEXT NOT NULL REFERENCES curriculum_tree_nodes(id) ON DELETE CASCADE,
                   PRIMARY KEY (tree_id, source_id, target_id)
                 )",
            )
            .execute(&pool)
            .await
            .expect("curriculum edge schema should create");

            let tree = CurriculumTreeRecord {
                id: "tree-1".to_string(),
                title: "Test map".to_string(),
                layout_mode: "auto".to_string(),
                created_at: 1,
                updated_at: 1,
            };
            let initial_node = CurriculumTreeNodeRecord {
                id: "tree-node-1".to_string(),
                tree_id: tree.id.clone(),
                workspace_id: Some("workspace-1".to_string()),
                title: "Original".to_string(),
                summary_hint: "Original summary".to_string(),
                layer_index: 0,
                pos_x: 0.0,
                pos_y: 0.0,
            };
            persist_curriculum_tree(&pool, &tree, &[initial_node], &[])
                .await
                .expect("initial curriculum graph should save");
            let active_delete_error = remove_curriculum_tree_and_linked_workspaces(&pool, &tree.id)
                .await
                .expect_err("active linked workspaces must block permanent deletion");
            assert!(
                active_delete_error.contains("Archive linked workspace"),
                "active workspace deletion should explain the archive requirement"
            );
            sqlx::query("UPDATE workspaces SET archived_at = 1 WHERE id = 'workspace-1'")
                .execute(&pool)
                .await
                .expect("linked workspace should archive");
            sqlx::query(
                "CREATE TRIGGER reject_test_tree_node BEFORE INSERT ON curriculum_tree_nodes
                 WHEN NEW.title = 'Trigger failure'
                 BEGIN SELECT RAISE(ABORT, 'triggered map restore failure'); END",
            )
            .execute(&pool)
            .await
            .expect("failure trigger should create");

            let updated_node = CurriculumTreeNodeRecord {
                id: "tree-node-1".to_string(),
                tree_id: tree.id.clone(),
                workspace_id: Some("workspace-1".to_string()),
                title: "Must roll back".to_string(),
                summary_hint: "Changed summary".to_string(),
                layer_index: 0,
                pos_x: 10.0,
                pos_y: 10.0,
            };
            let failed_node = CurriculumTreeNodeRecord {
                id: "failed-tree-node".to_string(),
                tree_id: tree.id.clone(),
                workspace_id: None,
                title: "Trigger failure".to_string(),
                summary_hint: "Failure".to_string(),
                layer_index: 0,
                pos_x: 0.0,
                pos_y: 0.0,
            };
            let error = restore_curriculum_tree_graph_transaction(
                &pool,
                &tree.id,
                &[updated_node, failed_node],
                &[],
                "free",
            )
            .await
            .expect_err("trigger failure should reject the map snapshot");
            assert!(
                error.contains("triggered map restore failure"),
                "the database error should be preserved: {error}"
            );
            let restored: (String, String) = sqlx::query_as(
                "SELECT curriculum_tree_nodes.title, curriculum_trees.layout_mode
                 FROM curriculum_tree_nodes
                 JOIN curriculum_trees ON curriculum_trees.id = curriculum_tree_nodes.tree_id
                 WHERE curriculum_tree_nodes.id = 'tree-node-1'",
            )
            .fetch_one(&pool)
            .await
            .expect("previous map state should remain available");
            assert_eq!(restored, ("Original".to_string(), "auto".to_string()));
            let failed_count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM curriculum_tree_nodes WHERE id = 'failed-tree-node'",
            )
            .fetch_one(&pool)
            .await
            .expect("failed map insert should be queryable");
            assert_eq!(failed_count.0, 0);

            let deleted_workspaces = remove_curriculum_tree_and_linked_workspaces(&pool, &tree.id)
                .await
                .expect("archived linked workspace should be deletable");
            assert_eq!(deleted_workspaces, vec!["workspace-1".to_string()]);
            let remaining_counts: (i64, i64) = sqlx::query_as(
                "SELECT
                   (SELECT COUNT(*) FROM curriculum_trees WHERE id = 'tree-1'),
                   (SELECT COUNT(*) FROM workspaces WHERE id = 'workspace-1')",
            )
            .fetch_one(&pool)
            .await
            .expect("deleted curriculum and workspace should be queryable");
            assert_eq!(remaining_counts, (0, 0));
        });
    }
}
