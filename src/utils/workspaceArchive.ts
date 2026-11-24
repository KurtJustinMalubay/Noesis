export function getUnarchivedWorkspaces<T extends { archived_at: number | null }>(
  workspaces: readonly T[]
): T[] {
  return workspaces.filter((workspace) => workspace.archived_at === null);
}
