use std::{
    sync::{
        OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::get_sqlite_pool;

const MINI_AGENDA_LABEL: &str = "mini-agenda";
static CALENDAR_SCHEMA_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
const CALENDAR_EVENT_SELECT: &str = r#"
    SELECT
      e.id,
      e.title,
      e.event_type,
      e.notes,
      e.due_date,
      e.due_time,
      e.is_completed,
      COALESCE(e.workspace_id, n.workspace_id) AS workspace_id,
      w.title AS workspace_title,
      e.quiz_id,
      n.title AS quiz_title,
      COALESCE(q.score, q.best_score) AS quiz_score,
      e.source,
      e.created_at
    FROM calendar_events e
    LEFT JOIN nodes n ON n.id = e.quiz_id
    LEFT JOIN node_quizzes q ON q.node_id = e.quiz_id
    LEFT JOIN workspaces w ON w.id = COALESCE(e.workspace_id, n.workspace_id)
"#;

static EVENT_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn calendar_events_range_query() -> String {
    format!(
        "{CALENDAR_EVENT_SELECT}
         WHERE e.due_date >= ? AND e.due_date <= ?
           AND (w.id IS NULL OR w.archived_at IS NULL)
           AND (n.id IS NULL OR n.archived_at IS NULL)
         ORDER BY e.due_date ASC, e.due_time ASC, e.id ASC"
    )
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventInput {
    pub id: Option<String>,
    pub title: String,
    pub event_type: String,
    pub notes: Option<String>,
    pub due_date: String,
    pub due_time: Option<String>,
    #[serde(default)]
    pub is_completed: bool,
    pub workspace_id: Option<String>,
    pub quiz_id: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    pub event_type: String,
    pub due_date: String,
    pub due_time: Option<String>,
    pub workspace_id: Option<String>,
    pub workspace_title: Option<String>,
    pub workspace_color: Option<String>,
    pub quiz_id: Option<String>,
    pub quiz_title: Option<String>,
    pub quiz_score: Option<f64>,
    pub is_completed: bool,
    pub source: String,
    pub created_at: String,
}

fn now_ms() -> Result<i64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?;
    i64::try_from(duration.as_millis()).map_err(|error| error.to_string())
}

fn event_id() -> Result<String, String> {
    let timestamp = now_ms()?;
    let sequence = EVENT_ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    Ok(format!("calendar-{timestamp}-{sequence}"))
}

fn validate_event(event: &CalendarEventInput) -> Result<(), String> {
    if event.title.trim().is_empty() {
        return Err("Calendar event title cannot be empty.".to_string());
    }
    if !matches!(
        event.event_type.as_str(),
        "exam" | "deadline" | "quiz_due" | "study_session" | "todo"
    ) {
        return Err("Calendar event type is not supported.".to_string());
    }
    if !is_iso_date(&event.due_date) {
        return Err("Calendar event dueDate must use YYYY-MM-DD format.".to_string());
    }
    if let Some(due_time) = event.due_time.as_deref() {
        if !is_hhmm_time(due_time) {
            return Err("Calendar event dueTime must use HH:MM format.".to_string());
        }
    }
    Ok(())
}

fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    let has_iso_shape = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
    if !has_iso_shape {
        return false;
    }

    let year = value[0..4].parse::<u16>().unwrap_or(0);
    let month = value[5..7].parse::<u8>().unwrap_or(0);
    let day = value[8..10].parse::<u8>().unwrap_or(0);
    let leap_year = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year => 29,
        2 => 28,
        _ => return false,
    };
    year > 0 && day > 0 && day <= days_in_month
}

fn is_hhmm_time(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 5
        && bytes[2] == b':'
        && bytes[0].is_ascii_digit()
        && bytes[1].is_ascii_digit()
        && bytes[3].is_ascii_digit()
        && bytes[4].is_ascii_digit()
        && value[0..2].parse::<u8>().is_ok_and(|hour| hour < 24)
        && value[3..5].parse::<u8>().is_ok_and(|minute| minute < 60)
}

fn workspace_accent(workspace_id: &str) -> String {
    const ACCENTS: [&str; 4] = ["#4f7a65", "#496f8f", "#b06348", "#a47c3b"];
    let hash = workspace_id.bytes().fold(2_166_136_261_u32, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(16_777_619)
    });
    ACCENTS[(hash as usize) % ACCENTS.len()].to_string()
}

fn calendar_events_ddl(table_name: &str) -> String {
    format!(
        r#"CREATE TABLE {table_name} (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            event_type TEXT NOT NULL
                CHECK (event_type IN ('exam', 'deadline', 'quiz_due', 'study_session', 'todo')),
            notes TEXT,
            due_date TEXT NOT NULL,
            due_time TEXT,
            is_completed INTEGER NOT NULL DEFAULT 0,
            workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
            quiz_id TEXT REFERENCES node_quizzes(node_id) ON DELETE SET NULL,
            created_at TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual'
        )"#
    )
}

fn calendar_schema_is_current(columns: &[(String, String)], table_sql: &str) -> bool {
    let has_column = |name: &str| columns.iter().any(|(column, _)| column == name);
    let type_is = |name: &str, expected: &str| {
        columns
            .iter()
            .find(|(column, _)| column == name)
            .is_some_and(|(_, column_type)| column_type.eq_ignore_ascii_case(expected))
    };

    [
        "id",
        "title",
        "event_type",
        "notes",
        "due_date",
        "due_time",
        "is_completed",
        "workspace_id",
        "quiz_id",
        "created_at",
        "source",
    ]
    .iter()
    .all(|column| has_column(column))
        && !has_column("updated_at")
        && type_is("created_at", "TEXT")
        && table_sql.to_ascii_lowercase().contains("check")
        && table_sql
            .to_ascii_lowercase()
            .contains("references node_quizzes(node_id)")
}

async fn calendar_columns(pool: &SqlitePool) -> Result<Vec<(String, String)>, String> {
    let rows = sqlx::query("PRAGMA table_info(calendar_events)")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Could not inspect calendar event schema: {error}"))?;
    rows.iter()
        .map(|row| {
            Ok((
                row.try_get::<String, _>("name")
                    .map_err(|error| format!("Could not read calendar event column: {error}"))?,
                row.try_get::<String, _>("type").map_err(|error| {
                    format!("Could not read calendar event column type: {error}")
                })?,
            ))
        })
        .collect()
}

async fn ensure_calendar_index(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_calendar_due_date ON calendar_events(due_date)")
        .execute(pool)
        .await
        .map_err(|error| format!("Could not index calendar events: {error}"))?;
    Ok(())
}

/// Upgrades the frontend v14 calendar schema in-place while preserving every event row.
pub(crate) async fn ensure_calendar_schema(pool: &SqlitePool) -> Result<(), String> {
    let _migration_guard = CALENDAR_SCHEMA_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;

    let table_sql: Option<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calendar_events'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("Could not inspect calendar event table: {error}"))?;

    let Some(table_sql) = table_sql else {
        sqlx::query(&calendar_events_ddl("calendar_events"))
            .execute(pool)
            .await
            .map_err(|error| format!("Could not create calendar event schema: {error}"))?;
        return ensure_calendar_index(pool).await;
    };

    let columns = calendar_columns(pool).await?;
    if calendar_schema_is_current(&columns, &table_sql) {
        return ensure_calendar_index(pool).await;
    }

    let column_exists = |name: &str| columns.iter().any(|(column, _)| column == name);
    let notes_column = if column_exists("notes") {
        "notes"
    } else if column_exists("description") {
        "description"
    } else {
        "NULL"
    };
    let quiz_column = if column_exists("quiz_id") {
        "quiz_id"
    } else if column_exists("quiz_node_id") {
        "quiz_node_id"
    } else {
        "NULL"
    };
    let source_column = if column_exists("source") {
        "COALESCE(source, 'manual')"
    } else {
        "'manual'"
    };
    let created_at_column = if column_exists("created_at") {
        "CAST(COALESCE(created_at, 0) AS TEXT)"
    } else {
        "'0'"
    };
    let completed_column = if column_exists("is_completed") {
        "COALESCE(is_completed, 0)"
    } else {
        "0"
    };
    let event_type_column = if column_exists("event_type") {
        "event_type"
    } else {
        "'todo'"
    };
    let due_date_column = if column_exists("due_date") {
        "COALESCE(due_date, '1970-01-01')"
    } else {
        "'1970-01-01'"
    };
    let due_time_column = if column_exists("due_time") {
        "due_time"
    } else {
        "NULL"
    };
    let workspace_column = if column_exists("workspace_id") {
        "workspace_id"
    } else {
        "NULL"
    };
    let id_column = if column_exists("id") {
        "id"
    } else {
        "lower(hex(randomblob(16)))"
    };
    let title_column = if column_exists("title") {
        "COALESCE(title, 'Untitled')"
    } else {
        "'Untitled'"
    };
    let legacy_type_note = format!(
        "CASE WHEN {event_type_column} IN ('exam', 'deadline', 'quiz_due', 'study_session', 'todo') \
         THEN {notes_column} \
         ELSE CASE WHEN {notes_column} IS NULL OR CAST({notes_column} AS TEXT) = '' \
           THEN 'Legacy event type: ' || COALESCE(CAST({event_type_column} AS TEXT), '<null>') \
           ELSE CAST({notes_column} AS TEXT) || char(10) || 'Legacy event type: ' || \
                COALESCE(CAST({event_type_column} AS TEXT), '<null>') END END"
    );
    let normalized_type = format!(
        "CASE WHEN {event_type_column} IN ('exam', 'deadline', 'quiz_due', 'study_session', 'todo') \
         THEN {event_type_column} ELSE 'todo' END"
    );

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Could not begin calendar schema migration: {error}"))?;
    sqlx::query("DROP TABLE IF EXISTS _noesis_calendar_events_migration")
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not prepare calendar schema migration: {error}"))?;
    sqlx::query(&calendar_events_ddl("_noesis_calendar_events_migration"))
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not create upgraded calendar schema: {error}"))?;
    let copy_sql = format!(
        r#"INSERT INTO _noesis_calendar_events_migration
           (id, title, event_type, notes, due_date, due_time, is_completed,
            workspace_id, quiz_id, created_at, source)
           SELECT {id_column}, {title_column}, {normalized_type}, {legacy_type_note},
                  {due_date_column}, {due_time_column}, {completed_column},
                  {workspace_column}, {quiz_column}, {created_at_column}, {source_column}
           FROM calendar_events"#
    );
    sqlx::query(&copy_sql)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not preserve existing calendar events: {error}"))?;
    sqlx::query("DROP TABLE calendar_events")
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not replace the legacy calendar table: {error}"))?;
    sqlx::query("ALTER TABLE _noesis_calendar_events_migration RENAME TO calendar_events")
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Could not activate upgraded calendar schema: {error}"))?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit calendar schema migration: {error}"))?;

    ensure_calendar_index(pool).await
}

async fn resolve_event_workspace(
    pool: &SqlitePool,
    mut event: CalendarEventInput,
) -> Result<CalendarEventInput, String> {
    validate_event(&event)?;

    if let Some(workspace_id) = event.workspace_id.as_deref() {
        let exists: Option<String> = sqlx::query_scalar("SELECT id FROM workspaces WHERE id = ?")
            .bind(workspace_id)
            .fetch_optional(pool)
            .await
            .map_err(|error| format!("Could not validate calendar workspace: {error}"))?;
        if exists.is_none() {
            return Err("The linked workspace does not exist.".to_string());
        }
    }

    if let Some(quiz_node_id) = event.quiz_id.as_deref() {
        let quiz_workspace: Option<String> = sqlx::query_scalar(
            "SELECT n.workspace_id
             FROM node_quizzes q
             JOIN nodes n ON n.id = q.node_id
             WHERE q.node_id = ?",
        )
        .bind(quiz_node_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("Could not validate linked quiz: {error}"))?;
        let quiz_workspace =
            quiz_workspace.ok_or_else(|| "The linked quiz does not exist.".to_string())?;

        if let Some(workspace_id) = event.workspace_id.as_deref() {
            if workspace_id != quiz_workspace {
                return Err("The linked quiz belongs to a different workspace.".to_string());
            }
        } else {
            event.workspace_id = Some(quiz_workspace);
        }
    }

    if event.id.as_deref().is_none_or(|id| id.trim().is_empty()) {
        event.id = Some(event_id()?);
    }
    Ok(event)
}

fn map_calendar_event(row: sqlx::sqlite::SqliteRow) -> Result<CalendarEvent, sqlx::Error> {
    let workspace_id: Option<String> = row.try_get("workspace_id")?;
    let workspace_title: Option<String> = row.try_get("workspace_title")?;
    Ok(CalendarEvent {
        id: row.try_get("id")?,
        title: row.try_get("title")?,
        notes: row.try_get("notes")?,
        event_type: row.try_get("event_type")?,
        due_date: row.try_get("due_date")?,
        due_time: row.try_get("due_time")?,
        workspace_color: workspace_id.as_deref().map(workspace_accent),
        workspace_id,
        workspace_title,
        quiz_id: row.try_get("quiz_id")?,
        quiz_title: row.try_get("quiz_title")?,
        quiz_score: row.try_get("quiz_score")?,
        is_completed: row.try_get::<i64, _>("is_completed")? != 0,
        source: row.try_get("source")?,
        created_at: row.try_get("created_at")?,
    })
}

async fn fetch_calendar_event(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<CalendarEvent>, String> {
    let query = format!("{CALENDAR_EVENT_SELECT} WHERE e.id = ?");
    let row = sqlx::query(&query)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("Could not retrieve calendar event: {error}"))?;
    row.map(map_calendar_event)
        .transpose()
        .map_err(|error| format!("Could not read calendar event: {error}"))
}

async fn upsert_event(
    pool: &SqlitePool,
    event: CalendarEventInput,
) -> Result<CalendarEvent, String> {
    let event = resolve_event_workspace(pool, event).await?;
    let id = event.id.as_deref().expect("event id was assigned");
    let now = now_ms()?;
    sqlx::query(
        r#"INSERT INTO calendar_events
           (id, title, event_type, notes, due_date, due_time, is_completed,
            workspace_id, quiz_id, created_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             event_type = excluded.event_type,
             notes = excluded.notes,
             due_date = excluded.due_date,
             due_time = excluded.due_time,
             is_completed = excluded.is_completed,
             workspace_id = excluded.workspace_id,
             quiz_id = excluded.quiz_id,
             source = excluded.source"#,
    )
    .bind(id)
    .bind(&event.title)
    .bind(&event.event_type)
    .bind(&event.notes)
    .bind(&event.due_date)
    .bind(&event.due_time)
    .bind(i64::from(event.is_completed))
    .bind(&event.workspace_id)
    .bind(&event.quiz_id)
    .bind(now.to_string())
    .bind(event.source.as_deref().unwrap_or("manual"))
    .execute(pool)
    .await
    .map_err(|error| format!("Could not save calendar event: {error}"))?;

    fetch_calendar_event(pool, id)
        .await?
        .ok_or_else(|| "The saved calendar event could not be retrieved.".to_string())
}

async fn bulk_create_events(
    pool: &SqlitePool,
    events: Vec<CalendarEventInput>,
) -> Result<Vec<String>, String> {
    let mut resolved_events = Vec::with_capacity(events.len());
    for event in events {
        resolved_events.push(resolve_event_workspace(pool, event).await?);
    }
    if resolved_events.is_empty() {
        return Ok(Vec::new());
    }

    let now = now_ms()?;
    let created_at = now.to_string();
    let event_ids = resolved_events
        .iter()
        .map(|event| {
            event
                .id
                .as_deref()
                .expect("event id was assigned")
                .to_string()
        })
        .collect::<Vec<_>>();
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Could not begin calendar event creation: {error}"))?;
    for event in resolved_events {
        if let Err(error) = sqlx::query(
            r#"INSERT INTO calendar_events
               (id, title, event_type, notes, due_date, due_time, is_completed,
                workspace_id, quiz_id, created_at, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(event.id.as_deref().expect("event id was assigned"))
        .bind(&event.title)
        .bind(&event.event_type)
        .bind(&event.notes)
        .bind(&event.due_date)
        .bind(&event.due_time)
        .bind(i64::from(event.is_completed))
        .bind(&event.workspace_id)
        .bind(&event.quiz_id)
        .bind(&created_at)
        .bind(event.source.as_deref().unwrap_or("manual"))
        .execute(&mut *transaction)
        .await
        {
            return match transaction.rollback().await {
                Ok(()) => Err(format!("Could not create calendar events: {error}")),
                Err(rollback_error) => Err(format!(
                    "Could not create calendar events ({error}) and rollback failed ({rollback_error})."
                )),
            };
        }
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not commit calendar event creation: {error}"))?;
    Ok(event_ids)
}

async fn toggle_event(pool: &SqlitePool, id: &str) -> Result<CalendarEvent, String> {
    let result = sqlx::query(
        "UPDATE calendar_events
         SET is_completed = CASE WHEN is_completed = 0 THEN 1 ELSE 0 END
         WHERE id = ?",
    )
    .bind(id)
    .execute(pool)
    .await
    .map_err(|error| format!("Could not toggle calendar event: {error}"))?;
    if result.rows_affected() == 0 {
        return Err("Calendar event was not found.".to_string());
    }

    fetch_calendar_event(pool, id)
        .await?
        .ok_or_else(|| "The updated calendar event could not be retrieved.".to_string())
}

async fn remove_event(pool: &SqlitePool, id: &str) -> Result<bool, String> {
    let result = sqlx::query("DELETE FROM calendar_events WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| format!("Could not delete calendar event: {error}"))?;
    Ok(result.rows_affected() > 0)
}

fn emit_calendar_updated(app: &AppHandle) -> Result<(), String> {
    app.emit("calendar:updated", ())
        .map_err(|error| format!("Could not notify calendar listeners: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_calendar_events(
    app: AppHandle,
    start_date: String,
    end_date: String,
) -> Result<Vec<CalendarEvent>, String> {
    if !is_iso_date(&start_date) || !is_iso_date(&end_date) || end_date < start_date {
        return Err("startDate and endDate must be ordered YYYY-MM-DD dates.".to_string());
    }
    let pool = get_sqlite_pool(&app).await?;
    ensure_calendar_schema(&pool).await?;
    let query = calendar_events_range_query();
    let rows = sqlx::query(&query)
        .bind(start_date)
        .bind(end_date)
        .fetch_all(&pool)
        .await
        .map_err(|error| format!("Could not retrieve calendar events: {error}"))?;
    rows.into_iter()
        .map(map_calendar_event)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read calendar events: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn upsert_calendar_event(
    app: AppHandle,
    event: CalendarEventInput,
) -> Result<CalendarEvent, String> {
    let pool = get_sqlite_pool(&app).await?;
    ensure_calendar_schema(&pool).await?;
    let saved = upsert_event(&pool, event).await?;
    emit_calendar_updated(&app)?;
    Ok(saved)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn bulk_create_calendar_events(
    app: AppHandle,
    events: Vec<CalendarEventInput>,
) -> Result<Vec<String>, String> {
    let pool = get_sqlite_pool(&app).await?;
    ensure_calendar_schema(&pool).await?;
    let event_ids = bulk_create_events(&pool, events).await?;
    emit_calendar_updated(&app)?;
    Ok(event_ids)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn toggle_calendar_event(app: AppHandle, id: String) -> Result<CalendarEvent, String> {
    let pool = get_sqlite_pool(&app).await?;
    ensure_calendar_schema(&pool).await?;
    let event = toggle_event(&pool, &id).await?;
    emit_calendar_updated(&app)?;
    Ok(event)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn delete_calendar_event(app: AppHandle, id: String) -> Result<bool, String> {
    let pool = get_sqlite_pool(&app).await?;
    ensure_calendar_schema(&pool).await?;
    let deleted = remove_event(&pool, &id).await?;
    emit_calendar_updated(&app)?;
    Ok(deleted)
}

#[tauri::command]
pub async fn toggle_mini_agenda_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MINI_AGENDA_LABEL) {
        window
            .unminimize()
            .and_then(|_| window.show())
            .and_then(|_| window.set_focus())
            .map_err(|error| format!("Could not focus mini-agenda window: {error}"))?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        MINI_AGENDA_LABEL,
        WebviewUrl::App("index.html#mini-agenda".into()),
    )
    .title("Mini agenda")
    .inner_size(320.0, 420.0)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|error| format!("Could not create mini-agenda window: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Could not focus mini-agenda window: {error}"))
}

#[tauri::command]
pub async fn close_mini_agenda_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MINI_AGENDA_LABEL) {
        window
            .close()
            .map_err(|error| format!("Could not close mini-agenda window: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use tokio::runtime::Builder;

    #[test]
    fn workspace_accent_is_stable_and_derived_from_id() {
        assert_eq!(
            workspace_accent("workspace-algorithms"),
            workspace_accent("workspace-algorithms")
        );
        assert_ne!(
            workspace_accent("workspace-algorithms"),
            workspace_accent("workspace-biology")
        );
    }

    #[test]
    fn calendar_schema_migration_preserves_rows_and_adds_source_index() {
        let runtime = Builder::new_current_thread().enable_time().build().unwrap();
        runtime.block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .expect("in-memory database should open");
            sqlx::query("PRAGMA foreign_keys = ON")
                .execute(&pool)
                .await
                .expect("SQLite foreign keys should be enabled");
            sqlx::query(
                "CREATE TABLE workspaces (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    archived_at INTEGER
                )",
            )
                .execute(&pool)
                .await
                .expect("workspace schema should create");
            sqlx::query(
                "CREATE TABLE nodes (
                    id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    archived_at INTEGER
                )",
            )
            .execute(&pool)
            .await
            .expect("node schema should create");
            sqlx::query(
                "CREATE TABLE node_quizzes (
                    node_id TEXT PRIMARY KEY,
                    quiz_type TEXT NOT NULL,
                    questions_json TEXT NOT NULL,
                    best_score REAL NOT NULL DEFAULT 0,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    score REAL
                )",
            )
            .execute(&pool)
            .await
            .expect("quiz schema should create");
            sqlx::query("INSERT INTO workspaces (id, title) VALUES ('workspace-1', 'Algorithms')")
                .execute(&pool)
                .await
                .expect("workspace should insert");
            sqlx::query(
                "INSERT INTO nodes (id, workspace_id, title)
                 VALUES ('node-1', 'workspace-1', 'Graph traversal')",
            )
            .execute(&pool)
            .await
            .expect("node should insert");
            sqlx::query(
                "INSERT INTO node_quizzes
                 (node_id, quiz_type, questions_json, best_score, attempt_count, score)
                 VALUES ('node-1', 'practice', '[]', 70, 2, 87.5)",
            )
            .execute(&pool)
            .await
            .expect("node quiz should insert");
            sqlx::query(
                "CREATE TABLE calendar_events (
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    description TEXT,
                    due_date TEXT NOT NULL,
                    due_time TEXT,
                    is_completed INTEGER NOT NULL DEFAULT 0,
                    workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
                    quiz_node_id TEXT REFERENCES node_quizzes(node_id) ON DELETE SET NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )",
            )
            .execute(&pool)
            .await
            .expect("legacy calendar schema should create");
            sqlx::query(
                "INSERT INTO calendar_events
                 (id, title, event_type, description, due_date, quiz_node_id, created_at, updated_at)
                 VALUES (
                    'existing', 'Keep me', 'custom_exam', 'Original notes',
                    '2026-01-01', 'node-1', 123, 1
                 )",
            )
            .execute(&pool)
            .await
            .expect("legacy event should insert");

            ensure_calendar_schema(&pool)
                .await
                .expect("calendar schema migration should succeed");
            ensure_calendar_schema(&pool)
                .await
                .expect("calendar schema migration should be repeatable");

            sqlx::query(
                "INSERT INTO workspaces (id, title, archived_at)
                 VALUES ('archived-workspace', 'Archived workspace', 1)",
            )
            .execute(&pool)
            .await
            .expect("archived workspace should insert");
            sqlx::query(
                "INSERT INTO nodes (id, workspace_id, title, archived_at)
                 VALUES ('archived-node', 'workspace-1', 'Archived concept', 1)",
            )
            .execute(&pool)
            .await
            .expect("archived concept should insert");
            sqlx::query(
                "INSERT INTO node_quizzes
                 (node_id, quiz_type, questions_json, best_score, attempt_count, score)
                 VALUES ('archived-node', 'practice', '[]', 0, 0, NULL)",
            )
            .execute(&pool)
            .await
            .expect("archived concept quiz should insert");
            sqlx::query(
                "INSERT INTO calendar_events
                 (id, title, event_type, due_date, workspace_id, quiz_id, created_at, source)
                 VALUES
                 ('archived-event', 'Archived event', 'todo', '2026-01-03',
                  'archived-workspace', NULL, '123', 'manual'),
                 ('archived-node-event', 'Archived concept quiz', 'quiz_due', '2026-01-03',
                  NULL, 'archived-node', '123', 'manual'),
                 ('global-event', 'Global event', 'todo', '2026-01-04',
                  NULL, NULL, '123', 'manual')",
            )
            .execute(&pool)
            .await
            .expect("calendar events should insert");
            let event_rows = sqlx::query(&calendar_events_range_query())
                .bind("2026-01-01")
                .bind("2026-01-31")
                .fetch_all(&pool)
                .await
                .expect("active calendar events should be queryable");
            let event_ids: Vec<String> = event_rows
                .iter()
                .map(|row| row.get("id"))
                .collect();
            assert!(event_ids.iter().any(|id| id == "existing"));
            assert!(event_ids.iter().any(|id| id == "global-event"));
            assert!(!event_ids.iter().any(|id| id == "archived-event"));
            assert!(!event_ids.iter().any(|id| id == "archived-node-event"));

            let row = sqlx::query(
                "SELECT title, source, event_type, notes, quiz_id, created_at
                 FROM calendar_events WHERE id = 'existing'",
            )
            .fetch_one(&pool)
            .await
            .expect("existing row should remain");
            assert_eq!(row.get::<String, _>("title"), "Keep me");
            assert_eq!(row.get::<String, _>("source"), "manual");
            assert_eq!(row.get::<String, _>("event_type"), "todo");
            let preserved_notes = row.get::<String, _>("notes");
            assert!(preserved_notes.contains("Original notes"));
            assert!(preserved_notes.contains("Legacy event type: custom_exam"));
            assert_eq!(row.get::<String, _>("quiz_id"), "node-1");
            assert_eq!(row.get::<String, _>("created_at"), "123");
            let current_columns = calendar_columns(&pool)
                .await
                .expect("upgraded column list should be readable");
            assert!(current_columns.iter().any(|(name, _)| name == "notes"));
            assert!(current_columns.iter().any(|(name, _)| name == "quiz_id"));
            assert!(!current_columns.iter().any(|(name, _)| name == "description"));
            assert!(!current_columns.iter().any(|(name, _)| name == "quiz_node_id"));

            let linked_event = upsert_event(
                &pool,
                CalendarEventInput {
                    id: Some("linked".to_string()),
                    title: "Review graph traversal".to_string(),
                    event_type: "quiz_due".to_string(),
                    notes: Some("Focus on BFS".to_string()),
                    due_date: "2026-01-02".to_string(),
                    due_time: None,
                    is_completed: false,
                    workspace_id: None,
                    quiz_id: Some("node-1".to_string()),
                    source: Some("ai_plan".to_string()),
                },
            )
            .await
            .expect("calendar event should link to the current node quiz schema");
            assert_eq!(linked_event.workspace_id.as_deref(), Some("workspace-1"));
            assert_eq!(linked_event.workspace_title.as_deref(), Some("Algorithms"));
            assert_eq!(
                linked_event.workspace_color.as_deref(),
                Some(workspace_accent("workspace-1").as_str())
            );
            assert_eq!(linked_event.quiz_id.as_deref(), Some("node-1"));
            assert_eq!(linked_event.quiz_title.as_deref(), Some("Graph traversal"));
            assert_eq!(linked_event.quiz_score, Some(87.5));
            assert_eq!(linked_event.notes.as_deref(), Some("Focus on BFS"));
            assert_eq!(linked_event.source, "ai_plan");

            let index: Option<String> = sqlx::query_scalar(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_calendar_due_date'",
            )
            .fetch_optional(&pool)
            .await
            .expect("index lookup should succeed");
            assert!(index.is_some());
            assert!(!current_columns
                .iter()
                .any(|(name, _)| name == "updated_at"));
        });
    }
}
