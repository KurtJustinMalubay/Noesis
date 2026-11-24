import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";
import type {
  CanvasLayoutMode,
  CurriculumTree,
  CurriculumTreeEdge,
  CurriculumTreeNode,
} from "../../types/domain";
import { canReach } from "../../utils/curriculumDag";

export interface CurriculumTreeGraph {
  tree: CurriculumTree;
  nodes: CurriculumTreeNode[];
  edges: CurriculumTreeEdge[];
}

export async function listCurriculumTrees(): Promise<CurriculumTree[]> {
  const db = await getDb();
  return db.select<CurriculumTree[]>(
    "SELECT * FROM curriculum_trees WHERE archived_at IS NULL ORDER BY updated_at DESC"
  );
}

export async function listArchivedCurriculumTrees(): Promise<CurriculumTree[]> {
  const db = await getDb();
  return db.select<CurriculumTree[]>(
    "SELECT * FROM curriculum_trees WHERE archived_at IS NOT NULL ORDER BY updated_at DESC"
  );
}

export async function getCurriculumTreeGraph(
  treeId: string
): Promise<CurriculumTreeGraph | null> {
  const db = await getDb();
  const [trees, nodes, edges] = await Promise.all([
    db.select<CurriculumTree[]>(
      "SELECT * FROM curriculum_trees WHERE id = $1",
      [treeId]
    ),
    db.select<CurriculumTreeNode[]>(
      "SELECT * FROM curriculum_tree_nodes WHERE tree_id = $1 ORDER BY layer_index, title COLLATE NOCASE",
      [treeId]
    ),
    db.select<CurriculumTreeEdge[]>(
      "SELECT * FROM curriculum_tree_edges WHERE tree_id = $1",
      [treeId]
    ),
  ]);
  const tree = trees[0];
  return tree ? { tree, nodes, edges } : null;
}

export async function createCurriculumTree(
  tree: CurriculumTree,
  nodes: CurriculumTreeNode[] = [],
  edges: CurriculumTreeEdge[] = []
): Promise<void> {
  await getDb();
  await serializeDbWrite(() =>
    invoke("create_curriculum_tree", { tree, nodes, edges })
  );
}

export async function renameCurriculumTree(
  treeId: string,
  title: string
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "UPDATE curriculum_trees SET title = $1, updated_at = $2 WHERE id = $3",
      [title.trim(), Date.now(), treeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The curriculum tree is no longer available.");
  }
}

export async function deleteCurriculumTree(treeId: string): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute("DELETE FROM curriculum_trees WHERE id = $1", [treeId])
  );
  if (result.rowsAffected === 0) {
    throw new Error("The curriculum tree is no longer available.");
  }
}

export async function archiveCurriculumTree(treeId: string): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "UPDATE curriculum_trees SET archived_at = $1 WHERE id = $2 AND archived_at IS NULL",
      [Date.now(), treeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The curriculum map is no longer available to archive.");
  }
}

export async function restoreCurriculumTree(treeId: string): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "UPDATE curriculum_trees SET archived_at = NULL WHERE id = $1 AND archived_at IS NOT NULL",
      [treeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The archived curriculum map could not be restored.");
  }
}

export async function deleteCurriculumTreeAndLinkedWorkspaces(
  treeId: string
): Promise<string[]> {
  await getDb();
  return serializeDbWrite(() =>
    invoke<string[]>("delete_curriculum_tree_and_linked_workspaces", {
      treeId,
    })
  );
}

export async function addCurriculumTreeNode(
  node: CurriculumTreeNode
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `INSERT INTO curriculum_tree_nodes
        (id, tree_id, workspace_id, title, summary_hint, layer_index, pos_x, pos_y)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        node.id,
        node.tree_id,
        node.workspace_id,
        node.title.trim(),
        node.summary_hint.trim(),
        node.layer_index,
        node.pos_x,
        node.pos_y,
      ]
    )
  );
}

export async function updateCurriculumTreeNode(
  treeId: string,
  nodeId: string,
  title: string,
  summaryHint: string
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      `UPDATE curriculum_tree_nodes
       SET title = $1, summary_hint = $2
       WHERE tree_id = $3 AND id = $4`,
      [title.trim(), summaryHint.trim(), treeId, nodeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The curriculum subject is no longer available.");
  }
}

export async function updateCurriculumTreeNodePosition(
  treeId: string,
  nodeId: string,
  x: number,
  y: number
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "UPDATE curriculum_tree_nodes SET pos_x = $1, pos_y = $2 WHERE tree_id = $3 AND id = $4",
      [x, y, treeId, nodeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The curriculum subject is no longer available.");
  }
}

export async function updateCurriculumTreeNodePositions(
  treeId: string,
  nodes: Array<Pick<CurriculumTreeNode, "id" | "pos_x" | "pos_y">>
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(async () => {
    for (const node of nodes) {
      await db.execute(
        "UPDATE curriculum_tree_nodes SET pos_x = $1, pos_y = $2 WHERE tree_id = $3 AND id = $4",
        [node.pos_x, node.pos_y, treeId, node.id]
      );
    }
  });
}

export async function updateCurriculumTreeLayoutMode(
  treeId: string,
  mode: CanvasLayoutMode
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "UPDATE curriculum_trees SET layout_mode = $1, updated_at = $2 WHERE id = $3",
      [mode, Date.now(), treeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The curriculum map is no longer available.");
  }
}

export async function restoreCurriculumTreeGraph(
  treeId: string,
  nodes: CurriculumTreeNode[],
  edges: CurriculumTreeEdge[],
  layoutMode: CanvasLayoutMode
): Promise<void> {
  await getDb();
  await serializeDbWrite(() =>
    invoke("restore_curriculum_tree_graph", {
      treeId,
      nodes,
      edges,
      layoutMode,
    })
  );
}

export async function linkCurriculumTreeWorkspace(
  treeId: string,
  nodeId: string,
  workspaceId: string
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      `UPDATE curriculum_tree_nodes
       SET workspace_id = $1
       WHERE tree_id = $2 AND id = $3 AND workspace_id IS NULL`,
      [workspaceId, treeId, nodeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("This subject is already linked or no longer exists.");
  }
}

export async function deleteCurriculumTreeNode(
  treeId: string,
  nodeId: string
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "DELETE FROM curriculum_tree_nodes WHERE tree_id = $1 AND id = $2",
      [treeId, nodeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The curriculum subject is no longer available.");
  }
}

export async function connectCurriculumTreeNodes(
  treeId: string,
  sourceId: string,
  targetId: string
): Promise<void> {
  if (sourceId === targetId) {
    throw new Error("A subject cannot be its own prerequisite.");
  }
  const db = await getDb();
  const edges = await db.select<CurriculumTreeEdge[]>(
    "SELECT * FROM curriculum_tree_edges WHERE tree_id = $1",
    [treeId]
  );
  if (canReach(edges, targetId, sourceId)) {
    throw new Error("This prerequisite would create a cycle.");
  }
  await serializeDbWrite(() =>
    db.execute(
      "INSERT INTO curriculum_tree_edges (tree_id, source_id, target_id) VALUES ($1, $2, $3)",
      [treeId, sourceId, targetId]
    )
  );
}

export async function disconnectCurriculumTreeNodes(
  treeId: string,
  sourceId: string,
  targetId: string
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      "DELETE FROM curriculum_tree_edges WHERE tree_id = $1 AND source_id = $2 AND target_id = $3",
      [treeId, sourceId, targetId]
    )
  );
}

export { canReach } from "../../utils/curriculumDag";
