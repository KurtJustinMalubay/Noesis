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
    "SELECT * FROM workspaces ORDER BY updated_at DESC"
  );
}

export async function deleteWorkspace(id: string): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute("DELETE FROM workspaces WHERE id = $1", [id])
  );
}