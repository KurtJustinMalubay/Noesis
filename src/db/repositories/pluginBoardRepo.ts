import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";

export interface PluginBoard {
  id: string;
  workspace_id: string;
  plugin_id: string;
  node_id: string | null;
  node_title: string | null;
  title: string;
  scene_json: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number;
}

export interface NewPluginBoard {
  id: string;
  workspace_id: string;
  plugin_id: string;
  node_id: string | null;
  title: string;
  scene_json: string;
  created_at: number;
}

export async function listPluginBoards(
  workspaceId: string,
  pluginId: string
): Promise<PluginBoard[]> {
  const db = await getDb();
  return db.select<PluginBoard[]>(
    `SELECT b.id, b.workspace_id, b.plugin_id, b.node_id, n.title AS node_title,
            b.title, b.scene_json, b.created_at, b.updated_at, b.last_opened_at
     FROM plugin_boards b
     LEFT JOIN nodes n ON n.id = b.node_id
     WHERE b.workspace_id = $1 AND b.plugin_id = $2
       AND (b.node_id IS NULL OR n.archived_at IS NULL)
     ORDER BY b.last_opened_at DESC, b.created_at DESC`,
    [workspaceId, pluginId]
  );
}

export async function createPluginBoard(board: NewPluginBoard): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `INSERT INTO plugin_boards
        (id, workspace_id, plugin_id, node_id, title, scene_json,
         created_at, updated_at, last_opened_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)`,
      [
        board.id,
        board.workspace_id,
        board.plugin_id,
        board.node_id,
        board.title,
        board.scene_json,
        board.created_at,
      ]
    )
  );
}

export async function savePluginBoardScene(
  id: string,
  sceneJson: string
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "UPDATE plugin_boards SET scene_json = $1, updated_at = $2 WHERE id = $3",
      [sceneJson, Date.now(), id]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The Excalidraw board no longer exists.");
  }
}

export async function markPluginBoardOpened(id: string): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute("UPDATE plugin_boards SET last_opened_at = $1 WHERE id = $2", [
      Date.now(),
      id,
    ])
  );
  if (result.rowsAffected === 0) {
    throw new Error("The Excalidraw board no longer exists.");
  }
}
