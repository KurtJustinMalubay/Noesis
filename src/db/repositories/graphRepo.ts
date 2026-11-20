import { getDb } from "../client";
import { buildMultiRowInsert, executeBatch } from "../batch";
import { serializeDbWrite } from "../writeQueue";
import type {
  Flashcard,
  GraphEdge,
  GraphNode,
  NodeStatus,
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
      "SELECT * FROM nodes WHERE workspace_id = $1 ORDER BY layer_index ASC, pos_x ASC",
      [workspaceId]
    ),
    db.select<GraphEdge[]>(
      "SELECT * FROM edges WHERE workspace_id = $1",
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