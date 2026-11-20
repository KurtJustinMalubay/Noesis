import type { GraphEdge, GraphNode, NodeStatus } from "../types/domain";
import { validateAndLayerDag } from "./dagTopology.ts";

export interface NodeStatusPatch {
  id: string;
  status: NodeStatus;
  in_degree_unmastered: number;
  mastery_score?: number;
}

export interface GraphStateResult {
  updatedNodes: GraphNode[];
  patches: NodeStatusPatch[];
  newlyUnlockedIds: string[];
}

export function recomputeGraphState(
  nodes: GraphNode[],
  edges: GraphEdge[]
): GraphStateResult {
  const workspaceId = nodes[0]?.workspace_id ?? "";
  const topology = validateAndLayerDag(
    workspaceId,
    nodes.map(({ id, title, summary_hint }) => ({ id, title, summary_hint })),
    edges.map(({ source_id, target_id }) => ({ source_id, target_id }))
  );
  if (topology.validEdges.length !== edges.length) {
    throw new Error("Cannot update a graph with invalid or cyclic edges.");
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const unmasteredByNode = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (nodesById.get(edge.source_id)?.status !== "mastered") {
      unmasteredByNode.set(
        edge.target_id,
        (unmasteredByNode.get(edge.target_id) ?? 0) + 1
      );
    }
  }

  const patches: NodeStatusPatch[] = [];
  const newlyUnlockedIds: string[] = [];
  const updatedNodes = nodes.map((node) => {
    const unmasteredCount = unmasteredByNode.get(node.id) ?? 0;
    const status: NodeStatus =
      node.status === "mastered"
        ? "mastered"
        : unmasteredCount > 0
          ? "locked"
          : node.is_hydrated === 1 || node.status === "in_progress"
            ? "in_progress"
            : "unlocked";
    const layerIndex = topology.layerByNode.get(node.id) ?? 0;

    if (
      status !== node.status ||
      unmasteredCount !== node.in_degree_unmastered
    ) {
      patches.push({
        id: node.id,
        status,
        in_degree_unmastered: unmasteredCount,
      });
    }
    if (node.status === "locked" && status === "unlocked") {
      newlyUnlockedIds.push(node.id);
    }
    return {
      ...node,
      status,
      in_degree_unmastered: unmasteredCount,
      layer_index: layerIndex,
    };
  });

  return { updatedNodes, patches, newlyUnlockedIds };
}

const childrenByEdges = new WeakMap<GraphEdge[], Map<string, string[]>>();

function getChildrenById(edges: GraphEdge[]): Map<string, string[]> {
  const cached = childrenByEdges.get(edges);
  if (cached) return cached;

  const children = new Map<string, string[]>();
  for (const edge of edges) {
    let outgoing = children.get(edge.source_id);
    if (!outgoing) {
      outgoing = [];
      children.set(edge.source_id, outgoing);
    }
    outgoing.push(edge.target_id);
  }
  childrenByEdges.set(edges, children);
  return children;
}

/**
 * Marks `targetNodeId` as mastered and propagates prerequisite decrements
 * downstream so any dependent node with 0 remaining unmastered parents unlocks immediately.
 */
export function computeMasteryCascade(
  nodes: GraphNode[],
  edges: GraphEdge[],
  targetNodeId: string,
  masteryScore = 1.0,
  nodeIndex?: ReadonlyMap<string, number>
): {
  updatedNodes: GraphNode[];
  patches: NodeStatusPatch[];
  newlyUnlockedIds: string[];
} {
  const indexById =
    nodeIndex ??
    new Map(nodes.map((node, index) => [node.id, index] as const));
  const nodeAt = (id: string): GraphNode | undefined => {
    const index = indexById.get(id);
    return index === undefined ? undefined : nodes[index];
  };
  const targetOriginal = nodeAt(targetNodeId);
  if (!targetOriginal) {
    return { updatedNodes: nodes, patches: [], newlyUnlockedIds: [] };
  }

  const patches: NodeStatusPatch[] = [];
  const newlyUnlockedIds: string[] = [];
  const wasAlreadyMastered = targetOriginal.status === "mastered";
  const nextMasteryScore = Math.max(
    targetOriginal.mastery_score,
    masteryScore
  );
  if (wasAlreadyMastered && nextMasteryScore === targetOriginal.mastery_score) {
    return { updatedNodes: nodes, patches, newlyUnlockedIds };
  }

  const updates = new Map<string, GraphNode>();
  const target: GraphNode = {
    ...targetOriginal,
    status: "mastered",
    mastery_score: nextMasteryScore,
  };
  updates.set(target.id, target);

  patches.push({
    id: target.id,
    status: "mastered",
    in_degree_unmastered: target.in_degree_unmastered,
    mastery_score: target.mastery_score,
  });

  // Only decrement downstream prerequisites on the first transition into 'mastered'
  if (!wasAlreadyMastered) {
    const outgoing = getChildrenById(edges).get(targetNodeId) ?? [];
    for (const childId of outgoing) {
      const childOriginal = nodeAt(childId);
      if (!childOriginal || childOriginal.status === "mastered") continue;

      const nextInDeg = Math.max(
        0,
        childOriginal.in_degree_unmastered - 1
      );
      const nextStatus =
        nextInDeg === 0 && childOriginal.status === "locked"
          ? "unlocked"
          : childOriginal.status;
      if (
        nextInDeg === childOriginal.in_degree_unmastered &&
        nextStatus === childOriginal.status
      ) {
        continue;
      }

      const child: GraphNode = {
        ...childOriginal,
        in_degree_unmastered: nextInDeg,
        status: nextStatus,
      };
      updates.set(child.id, child);
      if (nextStatus === "unlocked" && childOriginal.status !== "unlocked") {
        newlyUnlockedIds.push(child.id);
      }

      patches.push({
        id: child.id,
        status: nextStatus,
        in_degree_unmastered: nextInDeg,
      });
    }
  }

  return {
    updatedNodes: nodes.map((node) => updates.get(node.id) ?? node),
    patches,
    newlyUnlockedIds,
  };
}