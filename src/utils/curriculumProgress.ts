import type { WorkspaceProgressSummary } from "../db/repositories/workspaceRepo";

export function summarizeCurriculumProgress(
  linkedWorkspaceIds: Iterable<string>,
  workspaceProgress: Record<string, WorkspaceProgressSummary>
): WorkspaceProgressSummary {
  const summary: WorkspaceProgressSummary = {
    nodeCount: 0,
    masteredCount: 0,
  };
  for (const workspaceId of new Set(linkedWorkspaceIds)) {
    const workspaceSummary = workspaceProgress[workspaceId];
    if (!workspaceSummary) continue;
    summary.nodeCount += workspaceSummary.nodeCount;
    summary.masteredCount += workspaceSummary.masteredCount;
  }
  return summary;
}
