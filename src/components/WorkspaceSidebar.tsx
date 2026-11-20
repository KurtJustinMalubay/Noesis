import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  FolderKanban,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import type { GraphNode, Workspace } from "../types/domain";

interface WorkspaceSidebarProps {
  collapsed: boolean;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  nodes: GraphNode[];
  dueCount: number;
  documentCount: number;
  onToggle: () => void;
  onSelect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onNewDag: () => void;
  onVault: () => void;
  onReview: () => void;
  onGuide: () => void;
  onSettings: () => void;
  onToast: (message: string) => void;
}

export function WorkspaceSidebar({
  collapsed,
  workspaces,
  activeWorkspaceId,
  nodes,
  dueCount,
  documentCount,
  onToggle,
  onSelect,
  onDelete,
  onNewDag,
  onVault,
  onReview,
  onGuide,
  onSettings,
  onToast,
}: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const filteredWorkspaces = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return workspaces;
    return workspaces.filter(
      (workspace) =>
        workspace.title.toLowerCase().includes(normalizedQuery) ||
        workspace.root_domain.toLowerCase().includes(normalizedQuery)
    );
  }, [query, workspaces]);

  const selectWorkspace = async (id: string) => {
    try {
      await onSelect(id);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteWorkspace = async (workspace: Workspace) => {
    if (
      !window.confirm(
        `Delete "${workspace.title}" and its learning graph? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await onDelete(workspace.id);
      onToast(`Deleted "${workspace.title}".`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    }
  };

  const masteredCount = nodes.filter((node) => node.status === "mastered").length;

  return (
    <aside
      data-collapsed={collapsed}
      className={`relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-sidebar)] ${
        collapsed ? "w-16" : "w-[260px]"
      }`}
    >
      <header className="relative h-14 shrink-0">
        <div
          className={`sidebar-crossfade absolute left-4 top-1/2 flex -translate-y-1/2 items-center gap-2.5 ${
            collapsed
              ? "pointer-events-none -translate-x-2 opacity-0"
              : "translate-x-0 opacity-100"
          }`}
          aria-hidden={collapsed}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-accent-button)] text-sm font-bold text-white">
            N
          </span>
          <span className="text-[11px] font-bold tracking-[0.14em] text-[var(--color-ink)]">
            NOESIS
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] ${
            collapsed
              ? "pointer-events-none translate-x-2 opacity-0"
              : "translate-x-0 opacity-100"
          }`}
          title="Collapse sidebar (Ctrl+\\)"
          aria-label="Collapse sidebar"
          tabIndex={collapsed ? -1 : 0}
          aria-hidden={collapsed}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] ${
            collapsed
              ? "translate-x-[-50%] opacity-100"
              : "pointer-events-none translate-x-[calc(-50%+8px)] opacity-0"
          }`}
          title="Expand sidebar (Ctrl+\\)"
          aria-label="Expand sidebar"
          tabIndex={collapsed ? 0 : -1}
          aria-hidden={!collapsed}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </header>

      <div className={collapsed ? "px-2" : "px-3"}>
        <button
          type="button"
          data-guide="new-dag"
          data-sidebar-new
          data-collapsed={collapsed}
          onClick={onNewDag}
          className={`relative flex h-10 w-full items-center overflow-hidden rounded-xl bg-[var(--color-accent-button)] text-[11px] font-semibold text-white hover:brightness-95 active:scale-[0.99] ${
            collapsed ? "justify-center" : "gap-2.5 px-3"
          }`}
          title="New DAG"
        >
          <Plus className="sidebar-new-icon h-4 w-4 shrink-0" />
          <span
            className={`sidebar-crossfade absolute left-10 whitespace-nowrap ${
              collapsed
                ? "pointer-events-none translate-x-2 opacity-0"
                : "translate-x-0 opacity-100"
            }`}
            aria-hidden={collapsed}
          >
            New DAG
          </span>
        </button>
      </div>

      <div className="relative px-3 pt-4">
        <div
          className={`sidebar-crossfade ${
            collapsed
              ? "pointer-events-none absolute left-3 right-3 top-4 -translate-x-2 opacity-0"
              : "relative translate-x-0 opacity-100"
          }`}
          aria-hidden={collapsed}
        >
          <label className="flex h-9 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 text-[var(--color-muted)] focus-within:border-[var(--color-accent)]">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              tabIndex={collapsed ? -1 : 0}
              placeholder="Search curricula"
              className="min-w-0 flex-1 select-text bg-transparent text-xs text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
        {!collapsed && (
          <p className="px-2 pb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
            Recent
          </p>
        )}
        {filteredWorkspaces.map((workspace) => {
          const active = workspace.id === activeWorkspaceId;
          const progress =
            active && nodes.length > 0 ? masteredCount / nodes.length : 0;
          return (
            <div
              key={workspace.id}
              className={`group relative flex items-center rounded-lg transition-[transform,opacity] ${
                active
                  ? "bg-[var(--color-selected)] text-[var(--color-ink)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
              } ${collapsed ? "mb-1 justify-center" : "mb-0.5"}`}
            >
              <button
                type="button"
                onClick={() => void selectWorkspace(workspace.id)}
                title={collapsed ? workspace.title : undefined}
                className={`relative flex min-w-0 items-center overflow-hidden rounded-lg text-left ${
                  collapsed ? "h-10 w-10 justify-center" : "min-h-10 flex-1 gap-2.5 px-2.5 py-2"
                }`}
              >
                <FolderKanban
                  className={`sidebar-crossfade absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 ${
                    collapsed
                      ? "opacity-100"
                      : "pointer-events-none translate-x-[calc(-50%-6px)] opacity-0"
                  }`}
                />
                <span
                  className={`sidebar-crossfade flex min-w-0 flex-1 items-center gap-2.5 ${
                    collapsed
                      ? "pointer-events-none -translate-x-2 opacity-0"
                      : "translate-x-0 opacity-100"
                  }`}
                  aria-hidden={collapsed}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      active
                        ? progress >= 1
                          ? "bg-[var(--color-success)]"
                          : progress > 0
                            ? "bg-[var(--color-accent)]"
                            : "bg-[var(--color-muted)]"
                        : "bg-[var(--color-border-strong)]"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium">
                      {workspace.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] text-[var(--color-muted)]">
                      {workspace.root_domain}
                    </span>
                  </span>
                </span>
              </button>
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => void deleteWorkspace(workspace)}
                  className="mr-1 rounded p-1 text-[var(--color-muted)] opacity-0 transition hover:bg-red-100 hover:text-red-700 group-hover:opacity-100 focus-visible:opacity-100"
                  title="Delete curriculum"
                  aria-label={`Delete ${workspace.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {!collapsed && filteredWorkspaces.length === 0 && (
          <p className="px-2 py-4 text-[11px] text-[var(--color-muted)]">
            {workspaces.length ? "No matches" : "No curricula yet"}
          </p>
        )}
      </div>

      <nav className={`shrink-0 border-t border-[var(--color-border)] py-2 ${collapsed ? "px-2" : "px-3"}`}>
        <SidebarAction
          collapsed={collapsed}
          icon={Database}
          label="Document Vault"
          badge={documentCount || undefined}
          guide="vault"
          onClick={onVault}
        />
        <SidebarAction
          collapsed={collapsed}
          icon={RotateCcw}
          label="Review Queue"
          badge={dueCount || undefined}
          guide="review-queue"
          onClick={onReview}
        />
        <SidebarAction
          collapsed={collapsed}
          icon={CircleHelp}
          label="App Guide"
          guide="guide"
          onClick={onGuide}
        />
        <SidebarAction
          collapsed={collapsed}
          icon={Settings}
          label="Settings"
          onClick={onSettings}
        />
      </nav>

      <div
        className={`sidebar-crossfade px-5 pb-3 text-[9px] text-[var(--color-muted)] ${
          collapsed
            ? "pointer-events-none absolute bottom-0 -translate-x-2 opacity-0"
            : "relative translate-x-0 opacity-100"
        }`}
        aria-hidden={collapsed}
      >
          Local-first · SQLite
      </div>
    </aside>
  );
}

function SidebarAction({
  collapsed,
  icon: Icon,
  label,
  badge,
  guide,
  onClick,
}: {
  collapsed: boolean;
  icon: typeof Database;
  label: string;
  badge?: number;
  guide?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-guide={guide}
      data-sidebar-action
      data-collapsed={collapsed}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`relative flex h-10 w-full items-center overflow-hidden rounded-lg text-[11px] font-medium text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] ${
        collapsed ? "justify-center" : "gap-2.5 px-2.5"
      }`}
    >
      <Icon className="sidebar-action-icon h-4 w-4 shrink-0" />
      <span
        className={`sidebar-crossfade ${
          collapsed
            ? "pointer-events-none absolute left-10 translate-x-2 opacity-0"
            : "ml-7 flex-1 translate-x-0 text-left opacity-100"
        }`}
        aria-hidden={collapsed}
      >
        {label}
      </span>
      {badge !== undefined && (
        <span
          className={`rounded-full bg-[var(--color-accent-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-accent)] ${
            collapsed ? "absolute right-0 top-0" : ""
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
