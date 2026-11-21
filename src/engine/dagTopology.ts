import type { GraphEdge, GraphNode } from "../types/domain";

export interface SkeletonNodeInput {
  id: string;
  title: string;
  summary_hint: string;
}

export interface SkeletonEdgeInput {
  source_id: string;
  target_id: string;
}

export interface ValidatedDagResult {
  orderedNodeIds: string[];
  validEdges: GraphEdge[];
  removedCycleEdges: SkeletonEdgeInput[];
  layerByNode: Map<string, number>;
  inDegreeByNode: Map<string, number>;
}

export function canReach(
  edges: Pick<GraphEdge, "source_id" | "target_id">[],
  startNodeId: string,
  targetNodeId: string
): boolean {
  if (startNodeId === targetNodeId) return true;

  const children = new Map<string, string[]>();
  for (const edge of edges) {
    let outgoing = children.get(edge.source_id);
    if (!outgoing) {
      outgoing = [];
      children.set(edge.source_id, outgoing);
    }
    outgoing.push(edge.target_id);
  }

  const visited = new Set<string>([startNodeId]);
  const stack = [startNodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of children.get(current) ?? []) {
      if (child === targetNodeId) return true;
      if (visited.has(child)) continue;
      visited.add(child);
      stack.push(child);
    }
  }
  return false;
}

/**
 * Validates and sanitizes a raw curriculum graph into a strict Directed Acyclic Graph (DAG).
 * 1. Filters dangling edges and self-loops.
 * 2. Detects and removes cycle-forming edges via DFS gray-stack tracking.
 * 3. Runs Kahn's algorithm to compute topological order and longest-path layer indices.
 */
export function validateAndLayerDag(
  workspaceId: string,
  rawNodes: SkeletonNodeInput[],
  rawEdges: SkeletonEdgeInput[]
): ValidatedDagResult {
  const nodeIds = new Set(rawNodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    adj.set(id, []);
  }

  // 1. Deduplicate & strip invalid/self edges
  const seenEdgeKeys = new Set<string>();
  const cleanEdges: SkeletonEdgeInput[] = [];
  for (const e of rawEdges) {
    if (!nodeIds.has(e.source_id) || !nodeIds.has(e.target_id)) continue;
    if (e.source_id === e.target_id) continue;
    const key = JSON.stringify([e.source_id, e.target_id]);
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);
    cleanEdges.push(e);
  }

  // 2. DFS cycle guard: drop any back-edge that closes a cycle
  const visitState = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=visited
  for (const id of nodeIds) visitState.set(id, 0);

  const validEdges: GraphEdge[] = [];
  const removedCycleEdges: SkeletonEdgeInput[] = [];

  // Build tentative adjacency list first
  const tentativeAdj = new Map<string, SkeletonEdgeInput[]>();
  for (const id of nodeIds) tentativeAdj.set(id, []);
  for (const e of cleanEdges) tentativeAdj.get(e.source_id)!.push(e);

  for (const n of rawNodes) {
    if (visitState.get(n.id) !== 0) continue;

    visitState.set(n.id, 1);
    const stack: Array<{ id: string; nextEdge: number }> = [
      { id: n.id, nextEdge: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const outgoing = tentativeAdj.get(frame.id)!;
      if (frame.nextEdge >= outgoing.length) {
        visitState.set(frame.id, 2);
        stack.pop();
        continue;
      }

      const edge = outgoing[frame.nextEdge++];
      const targetState = visitState.get(edge.target_id)!;
      if (targetState === 1) {
        removedCycleEdges.push(edge);
        continue;
      }

      validEdges.push({
        workspace_id: workspaceId,
        source_id: edge.source_id,
        target_id: edge.target_id,
      });
      adj.get(edge.source_id)!.push(edge.target_id);
      if (targetState === 0) {
        visitState.set(edge.target_id, 1);
        stack.push({ id: edge.target_id, nextEdge: 0 });
      }
    }
  }

  // 3. Kahn's topological sort + longest-path layer assignment
  const inDegree = new Map<string, number>();
  const layerByNode = new Map<string, number>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    layerByNode.set(id, 0);
  }

  for (const e of validEdges) {
    inDegree.set(e.target_id, (inDegree.get(e.target_id) ?? 0) + 1);
  }

  // Preserve input order as deterministic tie-breaker for root nodes
  const queue: string[] = [];
  const queuedRoots = new Set<string>();
  for (const node of rawNodes) {
    if (
      inDegree.get(node.id) === 0 &&
      !queuedRoots.has(node.id)
    ) {
      queue.push(node.id);
      queuedRoots.add(node.id);
    }
  }

  const orderedNodeIds: string[] = [];
  const workingInDegree = new Map(inDegree);

  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    orderedNodeIds.push(u);
    const uLayer = layerByNode.get(u) ?? 0;

    for (const v of adj.get(u) ?? []) {
      const candidateLayer = uLayer + 1;
      if (candidateLayer > (layerByNode.get(v) ?? 0)) {
        layerByNode.set(v, candidateLayer);
      }
      const nextDeg = (workingInDegree.get(v) ?? 1) - 1;
      workingInDegree.set(v, nextDeg);
      if (nextDeg === 0) {
        queue.push(v);
      }
    }
  }

  return {
    orderedNodeIds,
    validEdges,
    removedCycleEdges,
    layerByNode,
    inDegreeByNode: inDegree,
  };
}

/**
 * Hydrates raw skeleton nodes into full GraphNode records with initial lock/unlock states.
 */
export function buildInitialGraphNodes(
  workspaceId: string,
  rawNodes: SkeletonNodeInput[],
  validated: ValidatedDagResult
): GraphNode[] {
  const now = Date.now();
  return rawNodes.map((raw) => {
    const inDeg = validated.inDegreeByNode.get(raw.id) ?? 0;
    return {
      id: raw.id,
      workspace_id: workspaceId,
      title: raw.title,
      summary_hint: raw.summary_hint,
      status: inDeg === 0 ? "unlocked" : "locked",
      mastery_score: 0.0,
      in_degree_unmastered: inDeg,
      layer_index: validated.layerByNode.get(raw.id) ?? 0,
      pos_x: 0,
      pos_y: 0,
      is_hydrated: 0,
      lesson_markdown: null,
      mermaid_diagram: null,
      source_citations: null,
      updated_at: now,
      archived_at: null,
    };
  });
}