import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../client";
import { buildMultiRowInsert, executeBatch } from "../batch";
import { serializeDbWrite } from "../writeQueue";
import type {
  Flashcard,
  GraphEdge,
  GraphNode,
  NodeStatus,
  Workspace,
} from "../../types/domain";

export async function saveGraphBatch(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Promise<void> {
  const db = await getDb();

  await serializeDbWrite(async () => {
    const nodeBatches = buildMultiRowInsert(
      "nodes",
      [
        "id",
        "workspace_id",
        "title",
        "summary_hint",
        "status",
        "mastery_score",
        "in_degree_unmastered",
        "layer_index",
        "pos_x",
        "pos_y",
        "is_hydrated",
        "lesson_markdown",
        "mermaid_diagram",
        "source_citations",
        "updated_at",
      ],
      nodes.map((node) => [
        node.id,
        node.workspace_id,
        node.title,
        node.summary_hint,
        node.status,
        node.mastery_score,
        node.in_degree_unmastered,
        node.layer_index,
        node.pos_x,
        node.pos_y,
        node.is_hydrated,
        node.lesson_markdown,
        node.mermaid_diagram,
        node.source_citations,
        node.updated_at,
      ]),
      "INSERT OR REPLACE"
    );
    for (const batch of nodeBatches) {
      await db.execute(batch.sql, batch.params);
    }

    const edgeBatches = buildMultiRowInsert(
      "edges",
      ["workspace_id", "source_id", "target_id"],
      edges.map((edge) => [
        edge.workspace_id,
        edge.source_id,
        edge.target_id,
      ]),
      "INSERT OR IGNORE"
    );
    for (const batch of edgeBatches) {
      await db.execute(batch.sql, batch.params);
    }
  });
}

export async function getWorkspaceGraph(workspaceId: string): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  const db = await getDb();
  const [nodes, edges] = await Promise.all([
    db.select<GraphNode[]>(
      `SELECT * FROM nodes
       WHERE workspace_id = $1 AND archived_at IS NULL
       ORDER BY layer_index ASC, pos_x ASC`,
      [workspaceId]
    ),
    db.select<GraphEdge[]>(
      `SELECT e.* FROM edges e
       JOIN nodes source ON source.id = e.source_id
       JOIN nodes target ON target.id = e.target_id
       WHERE e.workspace_id = $1
         AND source.archived_at IS NULL
         AND target.archived_at IS NULL`,
      [workspaceId]
    ),
  ]);
  return { nodes, edges };
}

export async function hydrateNodeBatch(
  nodeId: string,
  lessonMarkdown: string,
  mermaidDiagram: string | null,
  citationsJson: string | null,
  cards: Flashcard[]
): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await serializeDbWrite(async () => {
    await db.execute(
      `UPDATE nodes
       SET is_hydrated = 1,
           lesson_markdown = $1,
           mermaid_diagram = $2,
           source_citations = $3,
           status = CASE WHEN status = 'unlocked' THEN 'in_progress' ELSE status END,
           updated_at = $4
       WHERE id = $5`,
      [lessonMarkdown, mermaidDiagram, citationsJson, now, nodeId]
    );

    const batches = buildMultiRowInsert(
      "flashcards",
      [
        "id",
        "node_id",
        "front",
        "back",
        "ease_factor",
        "interval_days",
        "repetitions",
        "next_review_at",
      ],
      cards.map((card) => [
          card.id,
          card.node_id,
          card.front,
          card.back,
          card.ease_factor,
          card.interval_days,
          card.repetitions,
          card.next_review_at,
      ]),
      "INSERT OR REPLACE"
    );
    for (const batch of batches) {
      await db.execute(batch.sql, batch.params);
    }
  });
}

export async function updateNodeLessonContent(
  nodeId: string,
  lessonMarkdown: string,
  mermaidDiagram: string | null,
  citationsJson: string | null
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `UPDATE nodes
       SET is_hydrated = 1,
           lesson_markdown = $1,
           mermaid_diagram = $2,
           source_citations = $3,
           updated_at = $4
       WHERE id = $5`,
      [lessonMarkdown, mermaidDiagram, citationsJson, Date.now(), nodeId]
    )
  );
}

export async function updateNodesStatusBatch(
  updates: Array<{
    id: string;
    status: NodeStatus;
    in_degree_unmastered: number;
    mastery_score?: number;
  }>
): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  await executeBatch(
    db,
    `UPDATE nodes
     SET status = $1,
         in_degree_unmastered = $2,
         mastery_score = COALESCE($3, mastery_score),
         updated_at = $4
     WHERE id = $5`,
    updates.map((u) => [
      u.status,
      u.in_degree_unmastered,
      u.mastery_score ?? null,
      now,
      u.id,
    ])
  );
}

export async function insertConceptNode(node: GraphNode): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `INSERT INTO nodes
        (id, workspace_id, title, summary_hint, status, mastery_score,
         in_degree_unmastered, layer_index, pos_x, pos_y, is_hydrated,
         lesson_markdown, mermaid_diagram, source_citations, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        node.id,
        node.workspace_id,
        node.title,
        node.summary_hint,
        node.status,
        node.mastery_score,
        node.in_degree_unmastered,
        node.layer_index,
        node.pos_x,
        node.pos_y,
        node.is_hydrated,
        node.lesson_markdown,
        node.mermaid_diagram,
        node.source_citations,
        node.updated_at,
      ]
    )
  );
}

export async function updateConceptNode(
  nodeId: string,
  title: string,
  summary: string
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      "UPDATE nodes SET title = $1, summary_hint = $2, updated_at = $3 WHERE id = $4",
      [title, summary, Date.now(), nodeId]
    )
  );
}

export async function archiveConceptNode(
  workspaceId: string,
  nodeId: string,
  archivedAt = Date.now()
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      `UPDATE nodes
       SET archived_at = $1, updated_at = $1
       WHERE workspace_id = $2 AND id = $3 AND archived_at IS NULL`,
      [archivedAt, workspaceId, nodeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The concept could not be moved to Archive.");
  }
}

export async function listArchivedConceptNodes(
  workspaceId: string
): Promise<GraphNode[]> {
  const db = await getDb();
  return db.select<GraphNode[]>(
    `SELECT * FROM nodes
     WHERE workspace_id = $1 AND archived_at IS NOT NULL
     ORDER BY archived_at DESC, title COLLATE NOCASE ASC`,
    [workspaceId]
  );
}

export async function restoreArchivedConceptNode(
  workspaceId: string,
  nodeId: string
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      `UPDATE nodes
       SET archived_at = NULL, updated_at = $1
       WHERE workspace_id = $2 AND id = $3 AND archived_at IS NOT NULL`,
      [Date.now(), workspaceId, nodeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The archived concept could not be restored.");
  }
}

export async function permanentlyDeleteArchivedConceptNode(
  workspaceId: string,
  nodeId: string
): Promise<void> {
  const db = await getDb();
  const result = await serializeDbWrite(() =>
    db.execute(
      "DELETE FROM nodes WHERE workspace_id = $1 AND id = $2 AND archived_at IS NOT NULL",
      [workspaceId, nodeId]
    )
  );
  if (result.rowsAffected === 0) {
    throw new Error("The archived concept no longer exists.");
  }
}

export async function insertGraphEdge(edge: GraphEdge): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      "INSERT OR IGNORE INTO edges (workspace_id, source_id, target_id) VALUES ($1, $2, $3)",
      [edge.workspace_id, edge.source_id, edge.target_id]
    )
  );
}

export async function deleteGraphEdge(
  workspaceId: string,
  sourceId: string,
  targetId: string
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      "DELETE FROM edges WHERE workspace_id = $1 AND source_id = $2 AND target_id = $3",
      [workspaceId, sourceId, targetId]
    )
  );
}

export async function restoreWorkspaceGraphSnapshot(
  workspaceId: string,
  targetNodes: GraphNode[],
  targetEdges: GraphEdge[],
  currentNodes: GraphNode[],
  layoutMode: Workspace["layout_mode"]
): Promise<void> {
  await getDb();
  await serializeDbWrite(() =>
    invoke("restore_workspace_graph_snapshot", {
      workspaceId,
      targetNodes,
      targetEdges,
      currentNodeIds: currentNodes.map((node) => node.id),
      layoutMode,
    })
  );
}

export async function updateGraphNodeState(nodes: GraphNode[]): Promise<void> {
  const db = await getDb();
  await executeBatch(
    db,
    `UPDATE nodes
     SET status = $1,
         in_degree_unmastered = $2,
         layer_index = $3,
         pos_x = $4,
         pos_y = $5,
         updated_at = $6
     WHERE id = $7 AND workspace_id = $8`,
    nodes.map((node) => [
      node.status,
      node.in_degree_unmastered,
      node.layer_index,
      node.pos_x,
      node.pos_y,
      Date.now(),
      node.id,
      node.workspace_id,
    ])
  );
}

export async function updateNodePosition(
  workspaceId: string,
  nodeId: string,
  x: number,
  y: number
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      "UPDATE nodes SET pos_x = $1, pos_y = $2, updated_at = $3 WHERE id = $4 AND workspace_id = $5",
      [x, y, Date.now(), nodeId, workspaceId]
    )
  );
}