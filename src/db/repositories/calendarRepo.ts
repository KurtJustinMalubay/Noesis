import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../client";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarQuizOption,
} from "../../calendar/types";

export async function getCalendarEvents(
  startDate: string,
  endDate: string
): Promise<CalendarEvent[]> {
  await getDb();
  return invoke<CalendarEvent[]>("get_calendar_events", {
    startDate,
    endDate,
  });
}

export async function upsertCalendarEvent(
  event: CalendarEventInput
): Promise<void> {
  await getDb();
  await invoke("upsert_calendar_event", { event });
}

export async function bulkCreateCalendarEvents(
  events: CalendarEventInput[]
): Promise<void> {
  await getDb();
  await invoke("bulk_create_calendar_events", { events });
}

export async function toggleCalendarEvent(id: string): Promise<void> {
  await getDb();
  await invoke("toggle_calendar_event", { id });
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  await getDb();
  await invoke("delete_calendar_event", { id });
}

export async function getCalendarQuizOptions(): Promise<CalendarQuizOption[]> {
  const db = await getDb();
  const rows = await db.select<CalendarQuizOption[]>(
    `SELECT
       n.id,
       n.title,
       n.workspace_id AS workspaceId,
       w.title AS workspaceTitle,
       q.score
     FROM node_quizzes q
     JOIN nodes n ON n.id = q.node_id
     JOIN workspaces w ON w.id = n.workspace_id
     WHERE w.archived_at IS NULL
       AND n.archived_at IS NULL
     ORDER BY w.updated_at DESC, n.title COLLATE NOCASE ASC`
  );
  return rows;
}
