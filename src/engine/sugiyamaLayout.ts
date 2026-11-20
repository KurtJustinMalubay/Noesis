import type { GraphEdge, GraphNode } from "../types/domain";

export interface LayoutConfig {
  nodeWidth: number;
  nodeHeight: number;
  horizontalGap: number;
  verticalGap: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  nodeWidth: 230,
  nodeHeight: 96,
  horizontalGap: 64,
  verticalGap: 110,
};

/**
 * Assigns deterministic (pos_x, pos_y) coordinates per topological layer
 * using a 2-pass barycenter heuristic to minimize edge crossings.
 */
export function computeSugiyamaLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): GraphNode[] {
  if (nodes.length === 0) return [];

  // Group nodes into layers
  const layers = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const l = node.layer_index;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push({ ...node });
  }
  const layerIndices = Array.from(layers.keys()).sort((a, b) => a - b);

  // Build parent & child lookup maps
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    parentsOf.set(n.id, []);
    childrenOf.set(n.id, []);
  }
  for (const e of edges) {
    parentsOf.get(e.target_id)?.push(e.source_id);
    childrenOf.get(e.source_id)?.push(e.target_id);
  }

  // Track horizontal order index within each layer
  const orderIndex = new Map<string, number>();
  const refreshOrderIndices = (layerNodes: GraphNode[]) => {
    layerNodes.forEach((node, index) => orderIndex.set(node.id, index));
  };
  for (const layerNodes of layers.values()) {
    refreshOrderIndices(layerNodes);
  }

  // Pass 1 (Top -> Down): order each layer by average parent X-order
  for (let layerPosition = 1; layerPosition < layerIndices.length; layerPosition++) {
    const l = layerIndices[layerPosition];
    const layerNodes = layers.get(l);
    if (!layerNodes || layerNodes.length <= 1) continue;

    const ordered = layerNodes
      .map((node, stableOrder) => ({
        node,
        barycenter: computeBarycenter(
          parentsOf.get(node.id) ?? [],
          orderIndex
        ),
        stableOrder,
      }))
      .sort(
        (a, b) =>
          a.barycenter - b.barycenter || a.stableOrder - b.stableOrder
      )
      .map(({ node }) => node);
    layers.set(l, ordered);
    refreshOrderIndices(ordered);
  }

  // Pass 2 (Bottom -> Up): refine ordering by average child X-order
  for (let layerPosition = layerIndices.length - 2; layerPosition >= 0; layerPosition--) {
    const l = layerIndices[layerPosition];
    const layerNodes = layers.get(l);
    if (!layerNodes || layerNodes.length <= 1) continue;

    const ordered = layerNodes
      .map((node, stableOrder) => ({
        node,
        barycenter: computeBarycenter(
          childrenOf.get(node.id) ?? [],
          orderIndex
        ),
        stableOrder,
      }))
      .sort(
        (a, b) =>
          a.barycenter - b.barycenter || a.stableOrder - b.stableOrder
      )
      .map(({ node }) => node);
    layers.set(l, ordered);
    refreshOrderIndices(ordered);
  }

  // Assign centered world coordinates
  const stepX = config.nodeWidth + config.horizontalGap;
  const stepY = config.nodeHeight + config.verticalGap;
  const laidOut: GraphNode[] = [];

  for (const l of layerIndices) {
    const layerNodes = layers.get(l)!;
    const totalRowWidth =
      layerNodes.length * config.nodeWidth +
      Math.max(0, layerNodes.length - 1) * config.horizontalGap;
    const startX = -totalRowWidth / 2;

    layerNodes.forEach((node, idx) => {
      node.pos_x = Math.round(startX + idx * stepX);
      node.pos_y = Math.round(l * stepY);
      laidOut.push(node);
    });
  }

  return laidOut;
}

function computeBarycenter(
  neighborIds: string[],
  orderIndex: Map<string, number>
): number {
  if (neighborIds.length === 0) return Number.MAX_SAFE_INTEGER;
  let sum = 0;
  let count = 0;
  for (const id of neighborIds) {
    const idx = orderIndex.get(id);
    if (idx !== undefined) {
      sum += idx;
      count++;
    }
  }
  return count === 0 ? Number.MAX_SAFE_INTEGER : sum / count;
}