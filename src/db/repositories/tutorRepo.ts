import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";

export type TutorMessageRole = "user" | "assistant";

export interface TutorLessonContext {
  id: string;
  title: string;
  summaryHint: string;
  layerIndex: number;
  lessonMarkdown: string | null;
}

export interface TutorThread {
  id: string;
  workspace_id: string | null;
  node_id: string | null;
  title: string;
  updated_at: number;
  rolling_summary: string;
  summary_cursor_created_at: number | null;
  summary_cursor_id: string | null;
  lessonContext: TutorLessonContext | null;
}

export interface TutorMessage {
  id: string;
  thread_id: string;
  role: TutorMessageRole;
  content: string;
  attached_lesson_title: string | null;
  citations: string[];
  created_at: number;
}

export interface TutorMessageCursor {
  createdAt: number;
  id: string;
}

export interface TutorMessagePage {
  messages: TutorMessage[];
  hasMore: boolean;
  nextCursor: TutorMessageCursor | null;
}

interface TutorThreadRow {
  id: string;
  workspace_id: string | null;
  node_id: string | null;
  title: string;
  updated_at: number;
  rolling_summary: string;
  summary_cursor_created_at: number | null;
  summary_cursor_id: string | null;
  lesson_title: string | null;
  lesson_summary_hint: string | null;
  lesson_layer_index: number | null;
  lesson_markdown: string | null;
}

interface TutorMessageRow {
  id: string;
  thread_id: string;
  role: TutorMessageRole;
  content: string;
  attached_lesson_title: string | null;
  citations_json: string | null;
  created_at: number;
}

const PAGE_SIZE = 10;

function mapThread(row: TutorThreadRow): TutorThread {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    node_id: row.node_id,
    title: row.title,
    updated_at: row.updated_at,
    rolling_summary: row.rolling_summary ?? "",
    summary_cursor_created_at: row.summary_cursor_created_at,
    summary_cursor_id: row.summary_cursor_id,
    lessonContext:
      row.node_id && row.lesson_title
        ? {
            id: row.node_id,
            title: row.lesson_title,
            summaryHint: row.lesson_summary_hint ?? "",
            layerIndex: row.lesson_layer_index ?? 0,
            lessonMarkdown: row.lesson_markdown,
          }
        : null,
  };
}

function mapMessage(row: TutorMessageRow): TutorMessage {
  let citations: string[] = [];
  if (row.citations_json) {
    try {
      const parsed: unknown = JSON.parse(row.citations_json);
      if (Array.isArray(parsed)) {
        citations = parsed.filter(
          (citation): citation is string => typeof citation === "string"
        );
      }
    } catch (error) {
      console.warn("Unable to parse persisted tutor citations.", error);
    }
  }

  return {
    id: row.id,
    thread_id: row.thread_id,
    role: row.role,
    content: row.content,
    attached_lesson_title: row.attached_lesson_title,
    citations,
    created_at: row.created_at,
  };
}

const THREAD_SELECT = `
  SELECT
    t.id, t.workspace_id, t.node_id, t.title, t.updated_at,
    t.rolling_summary, t.summary_cursor_created_at, t.summary_cursor_id,
    n.title AS lesson_title,
    n.summary_hint AS lesson_summary_hint,
    n.layer_index AS lesson_layer_index,
    n.lesson_markdown AS lesson_markdown
  FROM tutor_threads t
  LEFT JOIN nodes n ON n.id = t.node_id
`;

export function createTutorThreadTitle(prompt: string): string {
  const words = prompt
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);

  while (words.length > 0 && words.length < 3) {
    words.push(words.length === 1 ? "Study" : "Chat");
  }

  return (words.join(" ") || "New Tutor Chat").slice(0, 48);
}

export async function listTutorThreads(
  workspaceId: string | null
): Promise<TutorThread[]> {
  const db = await getDb();
  const rows = await db.select<TutorThreadRow[]>(
    `${THREAD_SELECT}
     WHERE t.workspace_id IS $1
       AND (t.node_id IS NULL OR n.archived_at IS NULL)
     ORDER BY t.updated_at DESC, t.id DESC`,
    [workspaceId]
  );
  return rows.map(mapThread);
}

export async function createTutorThread(
  workspaceId: string | null,
  title = "New chat",
  nodeId: string | null = null
): Promise<TutorThread> {
  const db = await getDb();
  const thread: TutorThread = {
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    node_id: nodeId,
    title,
    updated_at: Date.now(),
    rolling_summary: "",
    summary_cursor_created_at: null,
    summary_cursor_id: null,
    lessonContext: null,
  };

  await serializeDbWrite(() =>
    db.execute(
      `INSERT INTO tutor_threads (id, workspace_id, node_id, title, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [thread.id, workspaceId, nodeId, title, thread.updated_at]
    )
  );

  return thread;
}

export async function updateTutorThread(
  threadId: string,
  options: {
    workspaceId: string | null;
    nodeId: string | null;
    title?: string;
  }
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `UPDATE tutor_threads
       SET workspace_id = $1,
           node_id = $2,
           title = COALESCE($3, title),
           updated_at = $4
       WHERE id = $5`,
      [
        options.workspaceId,
        options.nodeId,
        options.title ?? null,
        Date.now(),
        threadId,
      ]
    )
  );
}

export async function renameTutorThread(
  threadId: string,
  title: string
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      "UPDATE tutor_threads SET title = $1, updated_at = $2 WHERE id = $3",
      [title.trim(), Date.now(), threadId]
    )
  );
}

export async function deleteTutorThread(threadId: string): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute("DELETE FROM tutor_threads WHERE id = $1", [threadId])
  );
}

export async function countTutorThreadMessages(
  threadId: string
): Promise<number> {
  const db = await getDb();
  const rows = await db.select<Array<{ count: number }>>(
    "SELECT COUNT(*) AS count FROM tutor_messages WHERE thread_id = $1",
    [threadId]
  );
  const count = rows[0]?.count;
  if (count === undefined) {
    throw new Error("Failed to retrieve the tutor message count.");
  }
  return count;
}

export async function insertTutorMessage(
  message: TutorMessage
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `INSERT INTO tutor_messages
       (id, thread_id, role, content, attached_lesson_title, citations_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        message.id,
        message.thread_id,
        message.role,
        message.content,
        message.attached_lesson_title,
        JSON.stringify(message.citations),
        message.created_at,
      ]
    )
  );
}

export async function updateTutorMessage(
  messageId: string,
  content: string,
  citations: string[] = []
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      "UPDATE tutor_messages SET content = $1, citations_json = $2 WHERE id = $3",
      [content, JSON.stringify(citations), messageId]
    )
  );
}

export async function clearTutorThreadMessages(
  threadId: string
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(async () => {
    await db.execute("DELETE FROM tutor_messages WHERE thread_id = $1", [
      threadId,
    ]);
    await db.execute(
      `UPDATE tutor_threads
       SET rolling_summary = '',
           summary_cursor_created_at = NULL,
           summary_cursor_id = NULL
       WHERE id = $1`,
      [threadId]
    );
  });
}

export async function loadTutorMessagesForSummary(
  threadId: string,
  cursor: TutorMessageCursor | null
): Promise<TutorMessage[]> {
  const db = await getDb();
  const cutoffRows = await db.select<
    Array<{ created_at: number; id: string }>
  >(
    `SELECT created_at, id
     FROM tutor_messages
     WHERE thread_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1 OFFSET 5`,
    [threadId]
  );
  const cutoff = cutoffRows[0];
  if (!cutoff) return [];

  const cursorClause = cursor
    ? "AND (created_at > $2 OR (created_at = $2 AND id > $3))"
    : "";
  const batchSize = cursor ? 12 : 6;
  const params: unknown[] = cursor
    ? [
        threadId,
        cursor.createdAt,
        cursor.id,
        cutoff.created_at,
        cutoff.id,
        batchSize,
      ]
    : [threadId, cutoff.created_at, cutoff.id, batchSize];
  const rows = await db.select<TutorMessageRow[]>(
    `SELECT id, thread_id, role, content, attached_lesson_title, citations_json, created_at
     FROM tutor_messages
     WHERE thread_id = $1
       ${cursorClause}
       AND (created_at < $${cursor ? 4 : 2}
         OR (created_at = $${cursor ? 4 : 2} AND id < $${cursor ? 5 : 3}))
     ORDER BY created_at ASC, id ASC
     LIMIT $${cursor ? 6 : 4}`,
    params
  );
  return rows.map(mapMessage);
}

export async function updateTutorRollingSummary(
  threadId: string,
  summary: string,
  cursor: TutorMessageCursor
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `UPDATE tutor_threads
       SET rolling_summary = $1,
           summary_cursor_created_at = $2,
           summary_cursor_id = $3
       WHERE id = $4`,
      [summary, cursor.createdAt, cursor.id, threadId]
    )
  );
}

export async function loadTutorMessagePage(
  threadId: string,
  before: TutorMessageCursor | null = null
): Promise<TutorMessagePage> {
  const db = await getDb();
  const rows = before
    ? await db.select<TutorMessageRow[]>(
        `SELECT id, thread_id, role, content, attached_lesson_title, citations_json, created_at
         FROM tutor_messages
         WHERE thread_id = $1
           AND (created_at < $2 OR (created_at = $2 AND id < $3))
         ORDER BY created_at DESC, id DESC
         LIMIT $4`,
        [threadId, before.createdAt, before.id, PAGE_SIZE]
      )
    : await db.select<TutorMessageRow[]>(
        `SELECT id, thread_id, role, content, attached_lesson_title, citations_json, created_at
         FROM tutor_messages
         WHERE thread_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [threadId, PAGE_SIZE]
      );

  const oldest = rows[rows.length - 1];
  const olderRows = oldest
    ? await db.select<Array<{ has_older: number }>>(
        `SELECT 1 AS has_older
         FROM tutor_messages
         WHERE thread_id = $1
           AND (created_at < $2 OR (created_at = $2 AND id < $3))
         LIMIT 1`,
        [threadId, oldest.created_at, oldest.id]
      )
    : [];

  return {
    messages: rows.reverse().map(mapMessage),
    hasMore: olderRows.length > 0,
    nextCursor: oldest
      ? { createdAt: oldest.created_at, id: oldest.id }
      : null,
  };
}
