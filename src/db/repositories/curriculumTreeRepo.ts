import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";
import type {
  CanvasLayoutMode,
  CurriculumTree,
  CurriculumTreeEdge,
  CurriculumTreeNode,
} from "../../types/domain";
import { canReach } from "../../utils/curriculumDag";
import { getUnarchivedWorkspaces } from "../../utils/workspaceArchive";

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
  const db = await getDb();
  await serializeDbWrite(async () => {
    await db.execute("BEGIN");
    try {
      await db.execute(
        "INSERT INTO curriculum_trees (id, title, layout_mode, created_at, updated_at, archived_at) VALUES ($1, $2, $3, $4, $5, NULL)",
        [
          tree.id,
          tree.title,
          tree.layout_mode,
          tree.created_at,
          tree.updated_at,
        ]
      );
      for (const node of nodes) {
        await db.execute(
          `INSERT INTO curriculum_tree_nodes
            (id, tree_id, workspace_id, title, summary_hint, layer_index, pos_x, pos_y)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            node.id,
            tree.id,
            node.workspace_id,
            node.title,
            node.summary_hint,
            node.layer_index,
            node.pos_x,
            node.pos_y,
          ]
        );
      }
      for (const edge of edges) {
        await db.execute(
          "INSERT INTO curriculum_tree_edges (tree_id, source_id, target_id) VALUES ($1, $2, $3)",
          [tree.id, edge.source_id, edge.target_id]
        );
      }
      await db.execute("COMMIT");
    } catch (error) {
      await db.execute("ROLLBACK");
      throw error;
    }
  });
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
  const db = await getDb();
  return serializeDbWrite(async () => {
    await db.execute("BEGIN");
    try {
      const linkedWorkspaces = await db.select<
        Array<{ id: string; title: string; archived_at: number | null }>
      >(
        `SELECT DISTINCT workspaces.id, workspaces.title, workspaces.archived_at
         FROM curriculum_tree_nodes
         JOIN workspaces ON workspaces.id = curriculum_tree_nodes.workspace_id
         WHERE curriculum_tree_nodes.tree_id = $1`,
        [treeId]
      );
      const unarchivedWorkspaces = getUnarchivedWorkspaces(linkedWorkspaces);
      if (unarchivedWorkspaces.length > 0) {
        const titles = unarchivedWorkspaces
          .map((workspace) => `"${workspace.title}"`)
          .join(", ");
        throw new Error(
          `Archive linked workspace${unarchivedWorkspaces.length === 1 ? "" : "s"} ${titles} before permanently deleting them.`
        );
      }
      const workspaceIds = linkedWorkspaces.map((workspace) => workspace.id);
      const result = await db.execute(
        "DELETE FROM curriculum_trees WHERE id = $1",
        [treeId]
      );
      if (result.rowsAffected === 0) {
        throw new Error("The curriculum map is no longer available.");
      }
      for (const workspaceId of workspaceIds) {
        const deletedWorkspace = await db.execute(
          "DELETE FROM workspaces WHERE id = $1 AND archived_at IS NOT NULL",
          [workspaceId]
        );
        if (deletedWorkspace.rowsAffected === 0) {
          throw new Error(
            "A linked workspace could not be permanently deleted because it is no longer archived."
          );
        }
      }
      await db.execute("COMMIT");
      return workspaceIds;
    } catch (error) {
      await db.execute("ROLLBACK");
      throw error;
    }
  });
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
  const db = await getDb();
  await serializeDbWrite(async () => {
    await db.execute("BEGIN");
    try {
      await db.execute(
        "DELETE FROM curriculum_tree_edges WHERE tree_id = $1",
        [treeId]
      );
      await db.execute(
        "DELETE FROM curriculum_tree_nodes WHERE tree_id = $1",
        [treeId]
      );
      for (const node of nodes) {
        await db.execute(
          `INSERT INTO curriculum_tree_nodes
            (id, tree_id, workspace_id, title, summary_hint, layer_index, pos_x, pos_y)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            node.id,
            treeId,
            node.workspace_id,
            node.title,
            node.summary_hint,
            node.layer_index,
            node.pos_x,
            node.pos_y,
          ]
        );
      }
      for (const edge of edges) {
        await db.execute(
          "INSERT INTO curriculum_tree_edges (tree_id, source_id, target_id) VALUES ($1, $2, $3)",
          [treeId, edge.source_id, edge.target_id]
        );
      }
      await db.execute(
        "UPDATE curriculum_trees SET layout_mode = $1, updated_at = $2 WHERE id = $3",
        [layoutMode, Date.now(), treeId]
      );
      await db.execute("COMMIT");
    } catch (error) {
      await db.execute("ROLLBACK");
      throw error;
    }
  });
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
