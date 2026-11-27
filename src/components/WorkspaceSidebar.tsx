import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BookOpen,
  ChevronLeft,
  CircleHelp,
  Database,
  FolderKanban,
  GitBranch,
  Layers,
  LoaderCircle,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Shapes,
  Settings,
  Trash2,
} from "lucide-react";
import type { CurriculumTree, GraphNode, Workspace } from "../types/domain";
import noesisLogo from "../assets/noesis-plain.png";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { DrawerChevronIcon } from "./DrawerChevronIcon";
import type {
  WorkspaceDeletionSummary,
  WorkspaceProgressSummary,
} from "../db/repositories/workspaceRepo";

interface WorkspaceSidebarProps {
  collapsed: boolean;
  isLockedView: boolean;
  isExcalidrawActive: boolean;
  onExcalidrawSidebarSlotChange: (element: HTMLDivElement | null) => void;
  onNewExcalidrawBoard: () => void;
  hasExcalidrawLesson: boolean;
  isExcalidrawLessonOpen: boolean;
  onToggleExcalidrawLesson: () => void;
  excalidrawBoardSearchQuery: string;
  onExcalidrawBoardSearchQueryChange: (query: string) => void;
  workspaces: Workspace[];
  archivedWorkspaces: Workspace[];
  workspaceProgress: Record<string, WorkspaceProgressSummary>;
  activeWorkspaceId: string | null;
  nodes: GraphNode[];
  dueCount: number;
  flashcardsEnabled: boolean;
  documentCount: number;
  onToggle: () => void;
  onSelect: (id: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onPermanentlyDelete: (id: string) => Promise<void>;
  onGetDeleteSummary: (id: string) => Promise<WorkspaceDeletionSummary>;
  onNewWorkspace: () => void;
  isDashboardActive: boolean;
  isCurriculumActive: boolean;
  curriculumTrees: CurriculumTree[];
  archivedCurriculumTrees: CurriculumTree[];
  selectedCurriculumTreeId: string | null;
  onSelectCurriculumTree: (id: string) => void;
  onRenameCurriculumTree: (id: string, title: string) => Promise<void>;
  onArchiveCurriculumTree: (id: string) => Promise<void>;
  onRestoreCurriculumTree: (id: string) => Promise<void>;
  onDeleteArchivedCurriculumTree: (id: string) => Promise<void>;
  onNewCurriculumMap: () => void;
  onVault: () => void;
  onReview: () => void;
  onGuide: () => void;
  onSettings: () => void;
  onRequestExit: () => void;
  onToast: (message: string) => void;
}

export function WorkspaceSidebar({
  collapsed,
  isLockedView,
  isExcalidrawActive,
  onExcalidrawSidebarSlotChange,
  onNewExcalidrawBoard,
  hasExcalidrawLesson,
  isExcalidrawLessonOpen,
  onToggleExcalidrawLesson,
  excalidrawBoardSearchQuery,
  onExcalidrawBoardSearchQueryChange,
  workspaces,
  archivedWorkspaces,
  workspaceProgress,
  activeWorkspaceId,
  nodes,
  dueCount,
  flashcardsEnabled,
  documentCount,
  onToggle,
  onSelect,
  onArchive,
  onRestore,
  onPermanentlyDelete,
  onGetDeleteSummary,
  onNewWorkspace,
  isDashboardActive,
  isCurriculumActive,
  curriculumTrees,
  archivedCurriculumTrees,
  selectedCurriculumTreeId,
  onSelectCurriculumTree,
  onRenameCurriculumTree,
  onArchiveCurriculumTree,
  onRestoreCurriculumTree,
  onDeleteArchivedCurriculumTree,
  onNewCurriculumMap,
  onVault,
  onReview,
  onGuide,
  onSettings,
  onRequestExit,
  onToast,
}: WorkspaceSidebarProps) {
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    window.matchMedia("(max-width: 760px)").matches
  );
  const [query, setQuery] = useState("");
  const [curriculumQuery, setCurriculumQuery] = useState("");
  const [showArchivedWorkspaces, setShowArchivedWorkspaces] = useState(false);
  const [showArchivedCurriculumTrees, setShowArchivedCurriculumTrees] =
    useState(false);
  const [curriculumTreeToDelete, setCurriculumTreeToDelete] =
    useState<CurriculumTree | null>(null);
  const [curriculumTreeToArchive, setCurriculumTreeToArchive] =
    useState<CurriculumTree | null>(null);
  const [editingCurriculumTreeId, setEditingCurriculumTreeId] = useState<
    string | null
  >(null);
  const [curriculumTitleDraft, setCurriculumTitleDraft] = useState("");
  const [isSavingCurriculumAction, setIsSavingCurriculumAction] =
    useState(false);
  const [isDeletingCurriculumTree, setIsDeletingCurriculumTree] =
    useState(false);
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
  const debouncedCurriculumQuery = useDebouncedValue(curriculumQuery);
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
  const filteredCurriculumTrees = useMemo(() => {
    const normalizedQuery = debouncedCurriculumQuery.trim().toLowerCase();
    if (!normalizedQuery) return curriculumTrees;
    return curriculumTrees.filter((tree) =>
      tree.title.toLowerCase().includes(normalizedQuery)
    );
  }, [curriculumTrees, debouncedCurriculumQuery]);
  const filteredArchivedCurriculumTrees = useMemo(() => {
    const normalizedQuery = debouncedCurriculumQuery.trim().toLowerCase();
    if (!normalizedQuery) return archivedCurriculumTrees;
    return archivedCurriculumTrees.filter((tree) =>
      tree.title.toLowerCase().includes(normalizedQuery)
    );
  }, [archivedCurriculumTrees, debouncedCurriculumQuery]);

  useEffect(
    () => () => {
      if (workspaceProgressTimerRef.current !== null) {
        window.clearTimeout(workspaceProgressTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => setIsCompactViewport(mediaQuery.matches);
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (isCompactViewport && !collapsed) onToggle();
  }, [isCompactViewport]);

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

  const restoreArchivedCurriculumTree = async (tree: CurriculumTree) => {
    try {
      await onRestoreCurriculumTree(tree.id);
      onToast(`Restored "${tree.title}".`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    }
  };

  const permanentlyDeleteCurriculumTree = async () => {
    if (!curriculumTreeToDelete || isDeletingCurriculumTree) return;
    setIsDeletingCurriculumTree(true);
    try {
      await onDeleteArchivedCurriculumTree(curriculumTreeToDelete.id);
      onToast(`Permanently deleted "${curriculumTreeToDelete.title}".`);
      setCurriculumTreeToDelete(null);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDeletingCurriculumTree(false);
    }
  };

  const masteredCount = nodes.filter((node) => node.status === "mastered").length;

  return (
    <>
    <aside
      data-collapsed={collapsed}
      data-locked-view={isLockedView}
      className={`relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-sidebar)] motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        collapsed ? "w-16" : "w-[280px]"
      }`}
    >
      {/* Brand header */}
      <header className="relative h-16 shrink-0">
        <div
          className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-2.5 ${
            isLockedView
              ? "left-1/2 -translate-x-1/2 opacity-100"
              : collapsed
                ? "sidebar-crossfade left-4 pointer-events-none -translate-x-2 opacity-0"
                : "sidebar-crossfade left-4 translate-x-0 opacity-100"
          }`}
          aria-hidden={!isLockedView && collapsed}
        >
          <img
            src={noesisLogo}
            alt=""
            className="h-8 w-8 rounded-lg object-cover"
          />
          {!collapsed && (
            <span className="text-xs font-bold tracking-[0.14em] text-[var(--color-ink)]">
              NOESIS
            </span>
          )}
        </div>
        {!isLockedView && (
          <>
            <button
              type="button"
              onClick={onToggle}
              className={`group/collapse absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] ${
                collapsed
                  ? "pointer-events-none translate-x-2 opacity-0"
                  : "translate-x-0 opacity-100"
              }`}
              title="Collapse sidebar (Ctrl+\\)"
              aria-label="Collapse sidebar"
              tabIndex={collapsed ? -1 : 0}
              aria-hidden={collapsed}
            >
              <DrawerChevronIcon
                direction="left"
                className="h-4 w-4 motion-safe:transition-transform motion-safe:duration-150 group-hover/collapse:-translate-x-0.5"
              />
            </button>
            <button
              type="button"
              onClick={onToggle}
              className={`group/expand absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] ${
                collapsed
                  ? "translate-x-[-50%] opacity-100"
                  : "pointer-events-none translate-x-[calc(-50%+8px)] opacity-0"
              }`}
              title="Expand sidebar (Ctrl+\\)"
              aria-label="Expand sidebar"
              tabIndex={collapsed ? 0 : -1}
              aria-hidden={!collapsed}
            >
              <DrawerChevronIcon
                direction="right"
                className="h-4 w-4 motion-safe:transition-transform motion-safe:duration-150 group-hover/expand:translate-x-0.5"
              />
            </button>
          </>
        )}
      </header>

      {!isLockedView && (
        <>
        <div
            className={`flex h-9 items-center gap-2 text-[var(--color-muted)] ${
              collapsed ? "justify-center px-2 pt-2" : "px-5 pt-2"
            }`}
            title={
              isCurriculumActive
                ? "Curriculum maps"
                : isExcalidrawActive
                  ? "Boards"
                  : "Workspaces"
            }
          >
            {isCurriculumActive ? (
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
            ) : isExcalidrawActive ? (
              <Shapes className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <FolderKanban className="h-3.5 w-3.5 shrink-0" />
            )}
            {!collapsed && (
              <span className="truncate font-mono text-[9px] font-semibold uppercase tracking-[0.12em]">
                {isCurriculumActive
                  ? "Curriculum maps"
                  : isExcalidrawActive
                    ? "Boards"
                    : "Workspaces"}
              </span>
            )}
        </div>

        <div className={collapsed ? "px-2" : "px-3"}>
        <button
          type="button"
          data-guide={
            isCurriculumActive
              ? "new-map"
              : isExcalidrawActive
                ? undefined
                : "new-dag"
          }
          data-sidebar-new
          data-collapsed={collapsed}
          onClick={
            isCurriculumActive
              ? onNewCurriculumMap
              : isExcalidrawActive
                ? onNewExcalidrawBoard
                : onNewWorkspace
          }
          className={`relative flex h-11 w-full items-center overflow-hidden rounded-xl bg-[var(--color-accent-button)] text-xs font-semibold text-white shadow-sm motion-safe:transition-[filter,transform] motion-safe:duration-150 hover:brightness-95 active:translate-y-[0.5px] motion-reduce:transition-none motion-reduce:transform-none ${
            collapsed ? "justify-center" : "gap-2.5 px-3"
          }`}
          title={
            isCurriculumActive
              ? "New curriculum map"
              : isExcalidrawActive
                ? "Create a board for the selected concept, or a workspace board"
                : "New workspace"
          }
          aria-label={
            isCurriculumActive
              ? "New curriculum map"
              : isExcalidrawActive
                ? "New board"
                : "New workspace"
          }
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
            {isCurriculumActive
              ? "New Curriculum Map"
              : isExcalidrawActive
                ? "New Board"
                : "New Workspace"}
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
          <label className="flex h-10 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-3 text-[var(--color-muted)] transition focus-within:border-[var(--color-accent)] focus-within:ring-2 focus-within:ring-[var(--color-accent-soft)]">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={
                isExcalidrawActive
                  ? excalidrawBoardSearchQuery
                  : isCurriculumActive
                    ? curriculumQuery
                    : query
              }
              onChange={(event) =>
                isExcalidrawActive
                  ? onExcalidrawBoardSearchQueryChange(event.target.value)
                  : isCurriculumActive
                  ? setCurriculumQuery(event.target.value)
                  : setQuery(event.target.value)
              }
              aria-label={
                isExcalidrawActive
                  ? "Search Excalidraw boards"
                  : isCurriculumActive
                  ? showArchivedCurriculumTrees
                    ? "Search archived curriculum maps"
                    : "Search curriculum maps"
                  : showArchivedWorkspaces
                    ? "Search archived workspaces"
                    : "Search workspaces"
              }
              tabIndex={collapsed ? -1 : 0}
              placeholder={
                isExcalidrawActive
                  ? "Search boards"
                  : isCurriculumActive
                  ? showArchivedCurriculumTrees
                    ? "Search archived maps"
                    : "Search curriculum maps"
                  : showArchivedWorkspaces
                    ? "Search archive"
                    : "Search workspaces"
              }
              className="min-w-0 flex-1 select-text bg-transparent text-xs text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
        {isExcalidrawActive ? (
          <div
            ref={onExcalidrawSidebarSlotChange}
            className="min-h-0 flex-1 overflow-hidden"
          />
        ) : isCurriculumActive ? (
          <>
            {!collapsed && (
              <div className="mb-2 px-2">
                <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                  {showArchivedCurriculumTrees ? "Archive" : "Curriculum maps"}
                </p>
              </div>
            )}
            {!showArchivedCurriculumTrees && filteredCurriculumTrees.map((tree) => {
              const isSelected = selectedCurriculumTreeId === tree.id;
              const isEditingThis = editingCurriculumTreeId === tree.id;
              return (
                <div
                  key={tree.id}
                  className={`group relative mb-0.5 flex min-h-10 items-center rounded-lg text-[11px] transition ${
                    isSelected
                      ? "bg-[var(--color-selected)] text-[var(--color-ink)]"
                      : "text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
                  } ${collapsed ? "justify-center px-0" : "px-2.5"}`}
                >
                  {isEditingThis && !collapsed ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const trimmed = curriculumTitleDraft.trim();
                        if (!trimmed || isSavingCurriculumAction) return;
                        setIsSavingCurriculumAction(true);
                        void onRenameCurriculumTree(tree.id, trimmed)
                          .then(() => {
                            setEditingCurriculumTreeId(null);
                            onToast(`Renamed map to "${trimmed}".`);
                          })
                          .catch((error) =>
                            onToast(
                              error instanceof Error
                                ? error.message
                                : String(error)
                            )
                          )
                          .finally(() => setIsSavingCurriculumAction(false));
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1.5 py-1"
                    >
                      <input
                        autoFocus
                        value={curriculumTitleDraft}
                        onChange={(event) =>
                          setCurriculumTitleDraft(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.stopPropagation();
                            setEditingCurriculumTreeId(null);
                          }
                        }}
                        maxLength={120}
                        aria-label="Curriculum map title"
                        className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-[11px] font-medium text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                      />
                      <button
                        type="submit"
                        disabled={isSavingCurriculumAction || !curriculumTitleDraft.trim()}
                        className="shrink-0 rounded-md bg-[var(--color-accent-button)] px-2 py-1 text-[10px] font-semibold text-[var(--color-accent-foreground)] disabled:opacity-50"
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        title={collapsed ? tree.title : undefined}
                        aria-label={tree.title}
                        aria-current={isSelected ? "page" : undefined}
                        onClick={() => onSelectCurriculumTree(tree.id)}
                        className={`flex min-h-10 min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-left ${
                          collapsed ? "justify-center px-0" : "pr-1"
                        }`}
                      >
                        <GitBranch className="h-4 w-4 shrink-0" />
                        {!collapsed && (
                          <span className="truncate">{tree.title}</span>
                        )}
                      </button>
                      {!collapsed && (
                        <span
                          className={`ml-auto flex shrink-0 items-center gap-0.5 transition-opacity duration-150 ${
                            isSelected
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectCurriculumTree(tree.id);
                              setCurriculumTitleDraft(tree.title);
                              setEditingCurriculumTreeId(tree.id);
                            }}
                            title="Edit curriculum map"
                            aria-label={`Edit ${tree.title}`}
                            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setCurriculumTreeToArchive(tree);
                            }}
                            title="Archive curriculum map"
                            aria-label={`Archive ${tree.title}`}
                            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)]"
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {showArchivedCurriculumTrees &&
              filteredArchivedCurriculumTrees.map((tree) => (
                <div
                  key={tree.id}
                  className={`group relative flex min-h-10 items-center rounded-lg px-2.5 text-[var(--color-muted)] hover:bg-[var(--color-hover)] ${
                    collapsed ? "mb-1 justify-center px-0" : "mb-0.5"
                  }`}
                >
                  <Archive className="h-4 w-4 shrink-0" />
                  {!collapsed && (
                    <span
                      title={tree.title}
                      className="min-w-0 flex-1 truncate pl-2.5 text-[11px]"
                    >
                      {tree.title}
                    </span>
                  )}
                  {!collapsed && (
                    <span className="ml-auto flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => void restoreArchivedCurriculumTree(tree)}
                        title="Restore curriculum map"
                        aria-label={`Restore ${tree.title}`}
                        className="rounded p-1 hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurriculumTreeToDelete(tree)}
                        title="Delete map permanently"
                        aria-label={`Delete ${tree.title} permanently`}
                        className="rounded p-1 hover:bg-red-100 hover:text-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </div>
              ))}
            {!collapsed &&
              (showArchivedCurriculumTrees
                ? filteredArchivedCurriculumTrees.length === 0
                : filteredCurriculumTrees.length === 0) && (
              <p className="px-2 py-4 text-[11px] leading-5 text-[var(--color-muted)]">
                {showArchivedCurriculumTrees
                  ? archivedCurriculumTrees.length
                    ? "No archived maps match"
                    : "Archive is empty"
                  : curriculumTrees.length
                    ? "No curriculum maps match"
                    : "Create a map to organize subjects and prerequisites."}
              </p>
            )}
          </>
        ) : showArchivedWorkspaces ? (
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
              const active =
                !isDashboardActive &&
                !isCurriculumActive &&
                workspace.id === activeWorkspaceId;
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
                      collapsed
                        ? "h-10 w-10 justify-center"
                        : "min-h-11 flex-1 gap-2.5 px-2.5 py-2"
                    }`}
                    aria-current={active ? "page" : undefined}
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
                        <span className="block truncate text-xs font-medium">
                          {workspace.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--color-muted)]">
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
                      title="Archive workspace"
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
                {workspaces.length ? "No matches" : "No workspaces yet"}
              </p>
            )}
          </>
        )}
      </div>
        </>
      )}

      {!isLockedView && (!isExcalidrawActive || hasExcalidrawLesson) && (
        <nav
          aria-label="Library tools"
          className={`shrink-0 space-y-0.5 border-t border-[var(--color-border)] py-2 ${
            collapsed ? "px-2" : "px-3"
          }`}
        >
          {isExcalidrawActive ? (
            <SidebarAction
              collapsed={collapsed}
              icon={BookOpen}
              label="Lesson"
              active={isExcalidrawLessonOpen}
              ariaPressed={isExcalidrawLessonOpen}
              onClick={onToggleExcalidrawLesson}
            />
          ) : (
            <>
              <SidebarAction
                collapsed={collapsed}
                icon={Archive}
                label="Archive"
                badge={
                  (isCurriculumActive
                    ? archivedCurriculumTrees.length
                    : archivedWorkspaces.length) || undefined
                }
                active={
                  isCurriculumActive
                    ? showArchivedCurriculumTrees
                    : showArchivedWorkspaces
                }
                onClick={() =>
                  isCurriculumActive
                    ? setShowArchivedCurriculumTrees((open) => !open)
                    : setShowArchivedWorkspaces((open) => !open)
                }
              />
              <SidebarAction
                collapsed={collapsed}
                icon={Database}
                label="Document Vault"
                badge={documentCount || undefined}
                guide="vault"
                onClick={onVault}
              />
              {flashcardsEnabled && (
                <SidebarAction
                  collapsed={collapsed}
                  icon={Layers}
                  label="Flashcards"
                  badge={dueCount || undefined}
                  onClick={onReview}
                />
              )}
            </>
          )}
        </nav>
      )}

      <nav
        aria-label="Utilities"
        className={`shrink-0 border-t border-[var(--color-border)] py-2 ${
          isLockedView ? "mt-auto" : ""
        } ${collapsed ? "px-2" : "px-3"}`}
      >
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
        <SidebarAction
          collapsed={collapsed}
          icon={LogOut}
          label="Exit Noesis"
          onClick={onRequestExit}
          danger
        />
      </nav>

      {!isLockedView && (
        <div
        className={`sidebar-crossfade px-5 pb-3 text-[9px] text-[var(--color-muted)] ${
          collapsed
            ? "pointer-events-none absolute bottom-0 -translate-x-2 opacity-0"
            : "relative translate-x-0 opacity-100"
        }`}
        aria-hidden={collapsed}
      >
          Saved on this device
        </div>
      )}
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
    {curriculumTreeToArchive && (
      <ConfirmDeleteModal
        title="Archive curriculum map?"
        itemName={curriculumTreeToArchive.title}
        description="The map and its subjects can be restored later. Linked workspaces and their study data will remain unchanged."
        mode="archive"
        deleteLabel="Move to Archive"
        onCancel={() => setCurriculumTreeToArchive(null)}
        onConfirm={async () => {
          const target = curriculumTreeToArchive;
          await onArchiveCurriculumTree(target.id);
          setCurriculumTreeToArchive(null);
          onToast(`Moved "${target.title}" to Archive. Linked workspaces were kept.`);
        }}
        onError={(error) =>
          onToast(error instanceof Error ? error.message : String(error))
        }
      />
    )}
    {curriculumTreeToDelete && (
      <ConfirmDeleteModal
        title="Permanently delete archived map?"
        itemName={curriculumTreeToDelete.title}
        description="This removes the archived map and its subjects. Linked workspaces and all their study data are kept."
        mode="delete"
        deleteLabel="Permanently delete"
        confirmationPhrase={curriculumTreeToDelete.title}
        onCancel={() => setCurriculumTreeToDelete(null)}
        onConfirm={permanentlyDeleteCurriculumTree}
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
  ariaPressed,
  danger = false,
  onClick,
}: {
  collapsed: boolean;
  icon: typeof Database;
  label: string;
  badge?: number;
  guide?: string;
  active?: boolean;
  ariaPressed?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-guide={guide}
      data-sidebar-action
      data-collapsed={collapsed}
      onClick={onClick}
      aria-pressed={ariaPressed}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={`relative flex h-11 w-full items-center overflow-hidden rounded-xl text-xs font-medium transition ${
        danger
          ? "text-rose-700 hover:bg-rose-50"
          : active
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
