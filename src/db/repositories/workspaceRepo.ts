import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";
import type { Workspace } from "../../types/domain";

export interface WorkspaceDeletionSummary {
  conceptCount: number;
  hydratedLessonCount: number;
  flashcardCount: number;
  workedExampleCount: number;
  quizAttemptCount: number;
}

export interface WorkspaceProgressSummary {
  nodeCount: number;
  masteredCount: number;
}

export async function createWorkspace(ws: Workspace): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `INSERT INTO workspaces
        (id, title, root_domain, layout_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        ws.id,
        ws.title,
        ws.root_domain,
        ws.layout_mode,
        ws.created_at,
        ws.updated_at,
      ]
    )
  );
}

export async function getWorkspaceDeletionSummary(
  workspaceId: string
): Promise<WorkspaceDeletionSummary> {
  const db = await getDb();
  const rows = await db.select<WorkspaceDeletionSummary[]>(
    `SELECT
       (SELECT COUNT(*) FROM nodes WHERE workspace_id = $1) AS conceptCount,
       (SELECT COUNT(*) FROM nodes
        WHERE workspace_id = $1 AND is_hydrated = 1) AS hydratedLessonCount,
       (SELECT COUNT(*) FROM flashcards f
        JOIN nodes n ON n.id = f.node_id
        WHERE n.workspace_id = $1) AS flashcardCount,
       (SELECT COUNT(*) FROM lesson_examples e
        JOIN nodes n ON n.id = e.node_id
        WHERE n.workspace_id = $1) AS workedExampleCount,
       (SELECT COALESCE(SUM(q.attempt_count), 0) FROM node_quizzes q
        JOIN nodes n ON n.id = q.node_id
        WHERE n.workspace_id = $1) AS quizAttemptCount`,
    [workspaceId]
  );
  const summary = rows[0];
  if (!summary) {
    throw new Error("Failed to retrieve the workspace deletion summary.");
  }
  return summary;
}

export async function updateWorkspaceLayoutMode(
  id: string,
  layoutMode: Workspace["layout_mode"]
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute("UPDATE workspaces SET layout_mode = $1 WHERE id = $2", [
      layoutMode,
      id,
    ])
  );
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const db = await getDb();
  return db.select<Workspace[]>(
    "SELECT * FROM workspaces WHERE archived_at IS NULL ORDER BY updated_at DESC"
  );
}

export async function getWorkspaceProgressSummaries(): Promise<
  Record<string, WorkspaceProgressSummary>
> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      workspace_id: string;
      node_count: number;
      mastered_count: number;
    }>
  >(
    `SELECT
       w.id AS workspace_id,
       COUNT(n.id) AS node_count,
       COALESCE(SUM(CASE WHEN n.status = 'mastered' THEN 1 ELSE 0 END), 0)
         AS mastered_count
     FROM workspaces w
     LEFT JOIN nodes n
       ON n.workspace_id = w.id AND n.archived_at IS NULL
     WHERE w.archived_at IS NULL
     GROUP BY w.id`
  );
  const summaries: Record<string, WorkspaceProgressSummary> = {};
  for (const row of rows) {
    summaries[row.workspace_id] = {
      nodeCount: Number(row.node_count),
      masteredCount: Number(row.mastered_count),
    };
  }
  return summaries;
}

export async function listArchivedWorkspaces(): Promise<Workspace[]> {
  const db = await getDb();
  return db.select<Workspace[]>(
    "SELECT * FROM workspaces WHERE archived_at IS NOT NULL ORDER BY archived_at DESC"
  );
}

export async function archiveWorkspace(
  id: string,
  archivedAt = Date.now()
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "UPDATE workspaces SET archived_at = $1 WHERE id = $2 AND archived_at IS NULL",
      [archivedAt, id]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The workspace could not be moved to Archive.");
  }
}

export async function restoreWorkspace(id: string): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "UPDATE workspaces SET archived_at = NULL WHERE id = $1 AND archived_at IS NOT NULL",
      [id]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The archived workspace could not be restored.");
  }
}

export async function permanentlyDeleteWorkspace(id: string): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "DELETE FROM workspaces WHERE id = $1 AND archived_at IS NOT NULL",
      [id]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The archived workspace no longer exists.");
  }
}