import type { CurriculumTreeEdge } from "../types/domain";

export function deduplicateCurriculumEdges(
  edges: Pick<CurriculumTreeEdge, "source_id" | "target_id">[]
): Pick<CurriculumTreeEdge, "source_id" | "target_id">[] {
  const uniqueEdges = new Map<string, Pick<CurriculumTreeEdge, "source_id" | "target_id">>();
  for (const edge of edges) {
    uniqueEdges.set(
      JSON.stringify([edge.source_id, edge.target_id]),
      edge
    );
  }
  return [...uniqueEdges.values()];
}

export function canReach(
  edges: Pick<CurriculumTreeEdge, "source_id" | "target_id">[],
  startId: string,
  targetId: string
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const children = outgoing.get(edge.source_id) ?? [];
    children.push(edge.target_id);
    outgoing.set(edge.source_id, children);
  }
  const visited = new Set([startId]);
  const stack = [startId];
  while (stack.length) {
    const current = stack.pop()!;
    for (const next of outgoing.get(current) ?? []) {
      if (next === targetId) return true;
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(next);
    }
  }
  return false;
}
