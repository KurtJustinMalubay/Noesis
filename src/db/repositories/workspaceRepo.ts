import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";
import type { Workspace } from "../../types/domain";

export async function createWorkspace(ws: Workspace): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `INSERT INTO workspaces (id, title, root_domain, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)`,
      [ws.id, ws.title, ws.root_domain, ws.created_at, ws.updated_at]
    )
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