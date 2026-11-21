import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  FolderKanban,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import type { GraphNode, Workspace } from "../types/domain";
import noesisLogo from "../assets/noesis-plain.png";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import type {
  WorkspaceDeletionSummary,
  WorkspaceProgressSummary,
} from "../db/repositories/workspaceRepo";

interface WorkspaceSidebarProps {
  collapsed: boolean;
  workspaces: Workspace[];
  archivedWorkspaces: Workspace[];
  workspaceProgress: Record<string, WorkspaceProgressSummary>;
  activeWorkspaceId: string | null;
  nodes: GraphNode[];
  dueCount: number;
  documentCount: number;
  onToggle: () => void;
  onSelect: (id: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onPermanentlyDelete: (id: string) => Promise<void>;
  onGetDeleteSummary: (id: string) => Promise<WorkspaceDeletionSummary>;
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
  archivedWorkspaces,
  workspaceProgress,
  activeWorkspaceId,
  nodes,
  dueCount,
  documentCount,
  onToggle,
  onSelect,
  onArchive,
  onRestore,
  onPermanentlyDelete,
  onGetDeleteSummary,
  onNewDag,
  onVault,
  onReview,
  onGuide,
  onSettings,
  onToast,
}: WorkspaceSidebarProps) {
  const [query, setQuery] = useState("");
  const [showArchivedWorkspaces, setShowArchivedWorkspaces] = useState(false);
  const [confirmationTarget, setConfirmationTarget] = useState<{
    workspace: Workspace;
    summary: WorkspaceDeletionSummary;
    action: "archive" | "delete";
  } | null>(null);
  const [loadingWorkspaceAction, setLoadingWorkspaceAction] = useState<{
    id: string;
    action: "archive" | "delete" | "restore";
  } | null>(null);
  const [loadingWorkspaceId, setLoadingWorkspaceId] = useState<string | null>(
    null
  );
  const [isWorkspaceProgressVisible, setIsWorkspaceProgressVisible] =
    useState(false);
  const workspaceProgressTimerRef = useRef<number | null>(null);
  const workspaceProgressVisibleAtRef = useRef<number | null>(null);
  const debouncedQuery = useDebouncedValue(query);
  const filteredWorkspaces = useMemo(() => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase();
    if (!normalizedQuery) return workspaces;
    return workspaces.filter(
      (workspace) =>
        workspace.title.toLowerCase().includes(normalizedQuery) ||
        workspace.root_domain.toLowerCase().includes(normalizedQuery)
    );
  }, [debouncedQuery, workspaces]);
  const filteredArchivedWorkspaces = useMemo(() => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase();
    if (!normalizedQuery) return archivedWorkspaces;
    return archivedWorkspaces.filter(
      (workspace) =>
        workspace.title.toLowerCase().includes(normalizedQuery) ||
        workspace.root_domain.toLowerCase().includes(normalizedQuery)
    );
  }, [archivedWorkspaces, debouncedQuery]);

  useEffect(
    () => () => {
      if (workspaceProgressTimerRef.current !== null) {
        window.clearTimeout(workspaceProgressTimerRef.current);
      }
    },
    []
  );

  const selectWorkspace = async (id: string) => {
    if (loadingWorkspaceId || id === activeWorkspaceId) return;
    setLoadingWorkspaceId(id);
    setIsWorkspaceProgressVisible(false);
    workspaceProgressVisibleAtRef.current = null;
    workspaceProgressTimerRef.current = window.setTimeout(() => {
      workspaceProgressVisibleAtRef.current = Date.now();
      setIsWorkspaceProgressVisible(true);
    }, 160);
    try {
      await onSelect(id);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    } finally {
      if (workspaceProgressTimerRef.current !== null) {
        window.clearTimeout(workspaceProgressTimerRef.current);
        workspaceProgressTimerRef.current = null;
      }
      const visibleAt = workspaceProgressVisibleAtRef.current;
      if (visibleAt !== null) {
        const remainingVisibleTime = Math.max(
          0,
          200 - (Date.now() - visibleAt)
        );
        if (remainingVisibleTime > 0) {
          await new Promise((resolve) =>
            window.setTimeout(resolve, remainingVisibleTime)
          );
        }
      }
      workspaceProgressVisibleAtRef.current = null;
      setLoadingWorkspaceId(null);
      setIsWorkspaceProgressVisible(false);
    }
  };

  const requestWorkspaceAction = async (
    workspace: Workspace,
    action: "archive" | "delete"
  ) => {
    if (loadingWorkspaceAction) return;
    setLoadingWorkspaceAction({ id: workspace.id, action });
    try {
      const summary = await onGetDeleteSummary(workspace.id);
      setConfirmationTarget({ workspace, summary, action });
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingWorkspaceAction(null);
    }
  };

  const confirmWorkspaceAction = async () => {
    if (!confirmationTarget) return;
    const { workspace, action } = confirmationTarget;
    if (action === "archive") {
      await onArchive(workspace.id);
      onToast(`Moved "${workspace.title}" to Archive.`);
      return;
    }
    await onPermanentlyDelete(workspace.id);
    onToast(`Permanently deleted "${workspace.title}".`);
  };

  const restoreArchivedWorkspace = async (workspace: Workspace) => {
    if (loadingWorkspaceAction) return;
    setLoadingWorkspaceAction({ id: workspace.id, action: "restore" });
    try {
      await onRestore(workspace.id);
      onToast(`Restored "${workspace.title}".`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingWorkspaceAction(null);
    }
  };

  const masteredCount = nodes.filter((node) => node.status === "mastered").length;

  return (
    <>
    <aside
      data-collapsed={collapsed}
      className={`relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-sidebar)] transition-[width] duration-300 ease-[var(--ease-spring)] ${
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
          <img
            src={noesisLogo}
            alt=""
            className="h-8 w-8 rounded-lg object-cover"
          />
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
              placeholder={
                showArchivedWorkspaces ? "Search archive" : "Search curricula"
              }
              className="min-w-0 flex-1 select-text bg-transparent text-xs text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
        {showArchivedWorkspaces ? (
          <>
            {!collapsed && (
              <button
                type="button"
                onClick={() => setShowArchivedWorkspaces(false)}
                className="mb-2 flex items-center gap-1.5 px-2 py-1 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back to Recent
              </button>
            )}
            {filteredArchivedWorkspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={`group relative flex items-center rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] ${
                  collapsed ? "mb-1 justify-center" : "mb-0.5"
                }`}
              >
                <div
                  title={collapsed ? workspace.title : undefined}
                  className={`flex min-w-0 items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 ${
                    collapsed ? "h-10 w-10 justify-center px-0" : "min-h-10 flex-1"
                  }`}
                >
                  <Archive className="h-4 w-4 shrink-0" />
                  {!collapsed && (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium">
                        {workspace.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[9px] text-[var(--color-muted)]">
                        {workspace.root_domain}
                      </span>
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <div className="mr-1 flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      disabled={loadingWorkspaceAction !== null}
                      onClick={() => void restoreArchivedWorkspace(workspace)}
                      className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] disabled:opacity-50"
                      title="Restore workspace"
                      aria-label={`Restore ${workspace.title}`}
                    >
                      {loadingWorkspaceAction?.id === workspace.id &&
                      loadingWorkspaceAction.action === "restore" ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={loadingWorkspaceAction !== null}
                      onClick={() =>
                        void requestWorkspaceAction(workspace, "delete")
                      }
                      className="rounded p-1 text-[var(--color-muted)] hover:bg-red-100 hover:text-red-700 disabled:opacity-50"
                      title="Delete permanently"
                      aria-label={`Delete ${workspace.title} permanently`}
                    >
                      {loadingWorkspaceAction?.id === workspace.id &&
                      loadingWorkspaceAction.action === "delete" ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!collapsed && filteredArchivedWorkspaces.length === 0 && (
              <p className="px-2 py-4 text-[11px] text-[var(--color-muted)]">
                {archivedWorkspaces.length
                  ? "No archived workspaces match"
                  : "Archive is empty"}
              </p>
            )}
          </>
        ) : (
          <>
            {isWorkspaceProgressVisible && loadingWorkspaceId && (
              <div
                role="status"
                className={`mb-3 rounded-lg bg-[var(--color-panel)] px-2.5 py-2 ${
                  collapsed ? "mx-1" : "mx-1.5"
                }`}
              >
                {!collapsed && (
                  <p className="mb-1.5 truncate text-[10px] font-medium text-[var(--color-muted)]">
                    Opening{" "}
                    {workspaces.find(
                      (workspace) => workspace.id === loadingWorkspaceId
                    )?.title ?? "workspace"}
                  </p>
                )}
                <div
                  role="progressbar"
                  aria-label="Opening workspace"
                  className="workspace-loading-track h-1 overflow-hidden rounded-full bg-[var(--color-border)]"
                >
                  <span className="workspace-loading-indicator block h-full w-[38%] rounded-full bg-[var(--color-accent)]" />
                </div>
              </div>
            )}
            {!collapsed && (
              <p className="px-2 pb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                Recent
              </p>
            )}
            {filteredWorkspaces.map((workspace) => {
              const active = workspace.id === activeWorkspaceId;
              const isLoading =
                isWorkspaceProgressVisible &&
                workspace.id === loadingWorkspaceId;
              const summary = workspaceProgress[workspace.id];
              const progress =
                active && nodes.length > 0 ? masteredCount / nodes.length : 0;
              const workspaceMasteryProgress =
                summary && summary.nodeCount > 0
                  ? summary.masteredCount / summary.nodeCount
                  : 0;
              return (
                <div
                  key={workspace.id}
                  className={`group relative flex items-center rounded-lg transition-[transform,opacity] ${
                    active
                      ? "bg-[var(--color-selected)] text-[var(--color-ink)]"
                      : `text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] ${
                          isLoading ? "bg-[var(--color-hover)]" : ""
                        }`
                  } ${collapsed ? "mb-1 justify-center" : "mb-0.5"}`}
                >
                  <button
                    type="button"
                    disabled={loadingWorkspaceId !== null}
                    onClick={() => void selectWorkspace(workspace.id)}
                    title={collapsed ? workspace.title : undefined}
                    aria-busy={isLoading}
                    className={`relative flex min-w-0 items-center overflow-hidden rounded-lg text-left ${
                      collapsed ? "h-10 w-10 justify-center" : "min-h-10 flex-1 gap-2.5 px-2.5 py-2"
                    }`}
                  >
                    {isLoading ? (
                      <LoaderCircle
                        className={`absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin ${
                          collapsed ? "" : "hidden"
                        }`}
                      />
                    ) : (
                      <FolderKanban
                        className={`sidebar-crossfade absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 ${
                          collapsed
                            ? "opacity-100"
                            : "pointer-events-none translate-x-[calc(-50%-6px)] opacity-0"
                        }`}
                      />
                    )}
                    <span
                      className={`sidebar-crossfade flex min-w-0 flex-1 items-center gap-2.5 ${
                        collapsed
                          ? "pointer-events-none -translate-x-2 opacity-0"
                          : "translate-x-0 opacity-100"
                      }`}
                      aria-hidden={collapsed}
                    >
                      {isLoading ? (
                        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-[var(--color-accent)]" />
                      ) : (
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
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium">
                          {workspace.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[9px] text-[var(--color-muted)]">
                          {isLoading
                            ? "Opening workspace…"
                            : workspace.root_domain}
                        </span>
                        {!active &&
                          !isLoading &&
                          summary &&
                          summary.nodeCount > 0 && (
                            <span
                              role="progressbar"
                              aria-label={`${workspace.title} mastery progress`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(
                                workspaceMasteryProgress * 100
                              )}
                              className="mt-1 block h-0.5 overflow-hidden rounded-full bg-[var(--color-border)] opacity-50"
                            >
                              <span
                                className="block h-full origin-left rounded-full bg-[var(--color-accent)] transition-transform duration-300 ease-[var(--ease-spring)]"
                                style={{
                                  width: "100%",
                                  transform: `scaleX(${workspaceMasteryProgress})`,
                                }}
                              />
                            </span>
                          )}
                      </span>
                    </span>
                  </button>
                  {!collapsed && (
                    <button
                      type="button"
                      disabled={loadingWorkspaceAction !== null}
                      onClick={() =>
                        void requestWorkspaceAction(workspace, "archive")
                      }
                      className="mr-1 rounded p-1 text-[var(--color-muted)] opacity-0 transition hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-wait disabled:opacity-50"
                      title="Archive curriculum"
                      aria-label={`Archive ${workspace.title}`}
                    >
                      {loadingWorkspaceAction?.id === workspace.id &&
                      loadingWorkspaceAction.action === "archive" ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Archive className="h-3.5 w-3.5" />
                      )}
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
          </>
        )}
      </div>

      <nav className={`shrink-0 border-t border-[var(--color-border)] py-2 ${collapsed ? "px-2" : "px-3"}`}>
        <SidebarAction
          collapsed={collapsed}
          icon={Archive}
          label="Archive"
          badge={archivedWorkspaces.length || undefined}
          active={showArchivedWorkspaces}
          onClick={() => setShowArchivedWorkspaces((open) => !open)}
        />
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
          guide="settings"
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
    {confirmationTarget && (
      <ConfirmDeleteModal
        mode={confirmationTarget.action}
        title={
          confirmationTarget.action === "archive"
            ? "Archive workspace?"
            : "Delete workspace permanently?"
        }
        itemName={confirmationTarget.workspace.title}
        description={
          confirmationTarget.action === "archive"
            ? "The workspace will leave Recent but remain in Archive with its study data. You can restore it later."
            : "This permanently deletes the archived workspace and its associated study data. This cannot be undone."
        }
        impactItems={[
          {
            label: "Concepts",
            value: confirmationTarget.summary.conceptCount,
          },
          {
            label: "Hydrated lessons",
            value: confirmationTarget.summary.hydratedLessonCount,
          },
          {
            label: "Flashcards",
            value: confirmationTarget.summary.flashcardCount,
          },
          {
            label: "Worked examples",
            value: confirmationTarget.summary.workedExampleCount,
          },
          {
            label: "Quiz attempts",
            value: confirmationTarget.summary.quizAttemptCount,
          },
        ]}
        deleteLabel={
          confirmationTarget.action === "archive"
            ? "Archive workspace"
            : "Delete permanently"
        }
        onCancel={() => setConfirmationTarget(null)}
        onConfirm={confirmWorkspaceAction}
        onError={(error) =>
          onToast(error instanceof Error ? error.message : String(error))
        }
      />
    )}
    </>
  );
}

function SidebarAction({
  collapsed,
  icon: Icon,
  label,
  badge,
  guide,
  active = false,
  onClick,
}: {
  collapsed: boolean;
  icon: typeof Database;
  label: string;
  badge?: number;
  guide?: string;
  active?: boolean;
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
      aria-label={collapsed ? label : undefined}
      className={`relative flex h-10 w-full items-center overflow-hidden rounded-lg text-[11px] font-medium transition ${
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
      } ${collapsed ? "justify-center" : "gap-2.5 px-2.5"}`}
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
