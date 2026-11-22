import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Bot,
  Maximize2,
  Minimize2,
  Moon,
  Network,
  Shapes,
  Sun,
} from "lucide-react";
import { getDb } from "./db/client";
import { useNoesisStore } from "./store/useNoesisStore";
import { usePluginStore } from "./plugins/pluginStore";
import { EXCALIDRAW_PLUGIN_ID } from "./plugins/registry";
import { DagCanvas } from "./components/DagCanvas";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { AppGuide } from "./components/AppGuide";
import { AnimatedPresence } from "./components/AnimatedPresence";
import { BootSplash } from "./components/BootSplash";
import { UpdateIndicator } from "./components/UpdateIndicator";
import type { GraphNode } from "./types/domain";
import { getWorkspaceDeletionSummary } from "./db/repositories/workspaceRepo";
import {
  createPluginBoard,
  listPluginBoards,
} from "./db/repositories/pluginBoardRepo";
import {
  setNativeFullscreen,
  toggleNativeFullscreen,
} from "./utils/windowControls";

const LessonReader = lazy(() =>
  import("./components/LessonReader").then((module) => ({
    default: module.LessonReader,
  }))
);
const TutorDrawer = lazy(() =>
  import("./components/TutorDrawer").then((module) => ({
    default: module.TutorDrawer,
  }))
);
const Modals = lazy(() =>
  import("./components/Modals").then((module) => ({
    default: module.Modals,
  }))
);
const ExcalidrawWorkspace = lazy(() =>
  import("./components/ExcalidrawWorkspace").then((module) => ({
    default: module.ExcalidrawWorkspace,
  }))
);

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [hasOpenedTutor, setHasOpenedTutor] = useState(false);
  const [tutorPanelReady, setTutorPanelReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mainView, setMainView] = useState<"graph" | "excalidraw">("graph");
  const [isExcalidrawFullscreen, setIsExcalidrawFullscreen] = useState(false);
  const [isExcalidrawLessonOpen, setIsExcalidrawLessonOpen] = useState(false);
  const [sidebarMotion, setSidebarMotion] = useState<
    "collapse" | "expand" | null
  >(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasOpenedGuide, setHasOpenedGuide] = useState(false);
  const [hasOpenedModal, setHasOpenedModal] = useState(false);
  const sidebarCollapsedRef = useRef(false);
  const startupGuideEvaluated = useRef(false);
  const launchFullscreenApplied = useRef(false);
  const lastSelectedNodeRef = useRef<GraphNode | null>(null);
  const store = useNoesisStore();
  const activeWorkspaceIdRef = useRef(store.activeWorkspaceId);
  const enabledPluginIds = usePluginStore((state) => state.enabledPluginIds);
  const excalidrawEnabled = enabledPluginIds.includes(EXCALIDRAW_PLUGIN_ID);
  const toggleSidebar = () => {
    const nextCollapsed = !sidebarCollapsedRef.current;
    sidebarCollapsedRef.current = nextCollapsed;
    setSidebarCollapsed(nextCollapsed);
    setSidebarMotion(
      mainView === "excalidraw"
        ? null
        : nextCollapsed
          ? "collapse"
          : "expand"
    );
  };

  useEffect(() => {
    let active = true;
    getDb()
      .then(async () => {
        if (!active) return;
        await store.initAppData();
        if (active) setDbReady(true);
      })
      .catch((error) => {
        if (active) setBootError(String(error));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      store.preferences.theme
    );
  }, [store.preferences.theme]);

  useEffect(() => {
    if (!dbReady || launchFullscreenApplied.current) return;
    launchFullscreenApplied.current = true;
    if (!store.preferences.launchInFullscreen) return;
    void setNativeFullscreen(true)
      .then(setIsFullscreen)
      .catch((error) =>
        store.showToast(
          error instanceof Error ? error.message : String(error)
        )
      );
  }, [dbReady, store.preferences.launchInFullscreen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "F11") {
        event.preventDefault();
        void toggleNativeFullscreen()
          .then(setIsFullscreen)
          .catch((error) =>
            store.showToast(
              error instanceof Error ? error.message : String(error)
            )
          );
        return;
      }
      if (event.ctrlKey && event.key === "\\") {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (store.activeModal !== "none") setHasOpenedModal(true);
  }, [store.activeModal]);

  useEffect(() => {
    if (!excalidrawEnabled) setMainView("graph");
  }, [excalidrawEnabled]);

  useEffect(() => {
    if (activeWorkspaceIdRef.current === store.activeWorkspaceId) return;
    activeWorkspaceIdRef.current = store.activeWorkspaceId;
    setMainView("graph");
    setIsExcalidrawFullscreen(false);
  }, [store.activeWorkspaceId]);

  useEffect(() => {
    if (mainView !== "excalidraw") setIsExcalidrawFullscreen(false);
  }, [mainView]);

  useEffect(() => {
    if (mainView === "excalidraw") setSidebarMotion(null);
  }, [mainView]);

  useEffect(() => {
    if (mainView === "excalidraw") {
      setIsExcalidrawLessonOpen(Boolean(store.selectedNodeId));
    }
  }, [mainView, store.selectedNodeId]);

  useEffect(() => {
    if (isGuideOpen) setHasOpenedGuide(true);
  }, [isGuideOpen]);

  useEffect(() => {
    if (
      !dbReady ||
      startupGuideEvaluated.current ||
      store.activeModal !== "none"
    ) {
      return;
    }
    startupGuideEvaluated.current = true;
    if (store.preferences.showAppTutorial) setIsGuideOpen(true);
  }, [dbReady, store.activeModal, store.preferences.showAppTutorial]);

  const closeGuide = () => {
    setIsGuideOpen(false);
  };
  const setGuideOnStartup = (show: boolean) => {
    void store
      .setPreferences({ ...store.preferences, showAppTutorial: show })
      .catch((error) =>
        store.showToast(error instanceof Error ? error.message : String(error))
      );
  };
  const toggleAppearanceMode = () => {
    const appearanceMode =
      store.preferences.appearanceMode === "dark" ? "light" : "dark";
    void store
      .setPreferences({
        ...store.preferences,
        appearanceMode,
        theme:
          appearanceMode === "dark"
            ? store.preferences.lastDarkThemeId
            : store.preferences.lastLightThemeId,
      })
      .catch((error) =>
        store.showToast(error instanceof Error ? error.message : String(error))
      );
  };
  const openLessonVisualBoard = async (node: GraphNode) => {
    const boards = await listPluginBoards(
      node.workspace_id,
      EXCALIDRAW_PLUGIN_ID
    );
    const existingBoard = boards.find((board) => board.node_id === node.id);
    if (!existingBoard) {
      const { convertToExcalidrawElements } =
        await import("@excalidraw/excalidraw");
      type SceneElements = ReturnType<typeof convertToExcalidrawElements>;
      const createTextStarter = () =>
        convertToExcalidrawElements([
          {
            type: "text",
            x: 120,
            y: 100,
            text: node.title,
            fontSize: 32,
          },
          {
            type: "text",
            x: 120,
            y: 170,
            text: node.summary_hint || "Add a visual explanation for this lesson.",
            fontSize: 18,
          },
        ]);
      let elements: SceneElements;
      let files: Record<string, unknown> = {};
      let conversionError: string | null = null;
      const mermaidDefinition = node.mermaid_diagram
        ?.replace(/^```mermaid\s*/i, "")
        .replace(/```$/g, "")
        .trim();

      if (mermaidDefinition) {
        try {
          const { parseMermaidToExcalidraw } = await import(
            "@excalidraw/mermaid-to-excalidraw"
          );
          const converted = await parseMermaidToExcalidraw(mermaidDefinition);
          elements = convertToExcalidrawElements(converted.elements);
          files = converted.files ?? {};
        } catch (error) {
          elements = createTextStarter();
          conversionError =
            error instanceof Error ? error.message : String(error);
        }
      } else {
        elements = createTextStarter();
      }

      const createdAt = Date.now();
      await createPluginBoard({
        id: crypto.randomUUID(),
        workspace_id: node.workspace_id,
        plugin_id: EXCALIDRAW_PLUGIN_ID,
        node_id: node.id,
        title: `${node.title} visual`,
        scene_json: JSON.stringify({
          elements,
          appState: {},
          files,
        }),
        created_at: createdAt,
      });
      store.showToast(
        conversionError
          ? `Diagram conversion failed; created a text-based board instead: ${conversionError}`
          : mermaidDefinition
            ? "Created an editable board from the lesson diagram."
            : "Created a visual starter board from the lesson."
      );
    } else {
      store.showToast("Opened this lesson's visual board.");
    }

    setIsExcalidrawFullscreen(false);
    setMainView("excalidraw");
  };

  const activeWorkspace =
    store.workspaces.find((workspace) => workspace.id === store.activeWorkspaceId) ??
    null;
  const selectedNode =
    store.nodes.find((node) => node.id === store.selectedNodeId) ?? null;
  if (selectedNode) lastSelectedNodeRef.current = selectedNode;
  const lessonNode = selectedNode ?? lastSelectedNodeRef.current;
  const masteredCount = store.nodes.filter(
    (node) => node.status === "mastered"
  ).length;

  return (
    <div
      data-theme={store.preferences.theme}
      data-font={store.preferences.fontFamily}
      data-reading-scale={store.preferences.readingScale}
      className="app-shell relative flex h-screen w-screen overflow-hidden bg-[var(--color-app-bg)] text-[var(--color-ink)]"
    >
      {bootError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
          <p className="text-lg font-semibold text-rose-700">
            Database Initialization Failed
          </p>
          <p className="mt-2 max-w-md text-xs text-[var(--color-muted)]">
            {bootError}
          </p>
        </div>
      ) : dbReady ? (
        <>
          <div className="boot-app-content boot-app-content-ready flex h-full w-full">
            <WorkspaceSidebar
              collapsed={sidebarCollapsed}
              workspaces={store.workspaces}
              archivedWorkspaces={store.archivedWorkspaces}
              workspaceProgress={store.workspaceProgress}
              activeWorkspaceId={store.activeWorkspaceId}
              nodes={store.nodes}
              dueCount={store.dueCards.length}
              documentCount={store.documents.length}
              onToggle={toggleSidebar}
              onSelect={(id) => {
                if (id !== store.activeWorkspaceId) {
                  setMainView("graph");
                  setIsExcalidrawFullscreen(false);
                }
                return store.selectWorkspace(id);
              }}
              onArchive={store.archiveWorkspace}
              onRestore={store.restoreWorkspace}
              onPermanentlyDelete={store.permanentlyDeleteWorkspace}
              onGetDeleteSummary={getWorkspaceDeletionSummary}
              onNewDag={() => store.setActiveModal("new_workspace")}
              onVault={() => store.setActiveModal("vault")}
              onReview={() => store.setActiveModal("review")}
              onGuide={() => setIsGuideOpen(true)}
              onSettings={() => store.setActiveModal("settings")}
              onToast={(message) => store.showToast(message)}
            />

            <div
              className="flex min-w-0 flex-1 flex-col"
              data-sidebar-motion={
                mainView === "excalidraw"
                  ? undefined
                  : sidebarMotion ?? undefined
              }
              onAnimationEnd={(event) => {
                const motion = event.currentTarget.dataset.sidebarMotion;
                if (
                  event.target === event.currentTarget &&
                  motion &&
                  event.animationName === `sidebar-shift-${motion}`
                ) {
                  setSidebarMotion(null);
                }
              }}
            >
        <header className="app-topbar z-10 flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5">
            <div className="flex min-w-0 items-center gap-4">
              <div className="min-w-0">
                <h1 className="truncate text-[13px] font-semibold">
                  {activeWorkspace?.title ?? "Learning studio"}
                </h1>
                {activeWorkspace && (
                  <p className="text-[10px] text-[var(--color-muted)]">
                    {masteredCount} of {store.nodes.length} mastered
                  </p>
                )}
              </div>
              {store.nodes.length > 0 && (
                <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-border)] sm:block">
                  <div
                    className="h-full origin-left rounded-full bg-[var(--color-success)] transition-transform duration-300 ease-[var(--ease-spring)]"
                    style={{
                      width: "100%",
                      transform: `scaleX(${masteredCount / store.nodes.length})`,
                    }}
                  />
                </div>
              )}
              {excalidrawEnabled && (
                <nav
                  aria-label="Workspace views"
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-1"
                >
                  <button
                    type="button"
                    onClick={() => setMainView("graph")}
                    aria-pressed={mainView === "graph"}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${
                      mainView === "graph"
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                        : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    }`}
                  >
                    <Network className="h-3.5 w-3.5" />
                    Graph
                  </button>
                  <button
                    type="button"
                    onClick={() => setMainView("excalidraw")}
                    aria-pressed={mainView === "excalidraw"}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${
                      mainView === "excalidraw"
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                        : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    }`}
                  >
                    <Shapes className="h-3.5 w-3.5" />
                    Excalidraw
                  </button>
                  {mainView === "excalidraw" && lessonNode && (
                    <button
                      type="button"
                      onClick={() =>
                        setIsExcalidrawLessonOpen((open) => !open)
                      }
                      aria-pressed={isExcalidrawLessonOpen}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${
                        isExcalidrawLessonOpen
                          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                          : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                      }`}
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      Lesson
                    </button>
                  )}
                  {mainView === "excalidraw" && (
                    <button
                      type="button"
                      onClick={() =>
                        setIsExcalidrawFullscreen((fullscreen) => !fullscreen)
                      }
                      aria-pressed={isExcalidrawFullscreen}
                      className="rounded-md px-2.5 py-1.5 text-[10px] font-semibold text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
                    >
                      {isExcalidrawFullscreen
                        ? "Restore canvas"
                        : "Expand canvas"}
                    </button>
                  )}
                </nav>
              )}
            </div>
            <div className="flex items-center gap-2">
              <UpdateIndicator onToast={store.showToast} />
              <button
                type="button"
                onClick={toggleAppearanceMode}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
                aria-label={
                  store.preferences.appearanceMode === "dark"
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                }
                title={
                  store.preferences.appearanceMode === "dark"
                    ? "Switch to light mode"
                    : "Switch to dark mode"
                }
              >
                {store.preferences.appearanceMode === "dark" ? (
                  <Sun className="h-3.5 w-3.5" />
                ) : (
                  <Moon className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                data-guide="tutor"
                onClick={() => {
                  setHasOpenedTutor(true);
                  store.setTutorOpen(!store.isTutorOpen);
                }}
                aria-pressed={store.isTutorOpen}
                aria-label={store.isTutorOpen ? "Close tutor" : "Open tutor"}
                title={store.isTutorOpen ? "Close tutor" : "Open tutor"}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold transition ${
                  store.isTutorOpen
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
                }`}
              >
                <Bot className="h-3.5 w-3.5" />
                Tutor
              </button>
              <button
                type="button"
                onClick={() =>
                  void toggleNativeFullscreen()
                    .then(setIsFullscreen)
                    .catch((error) =>
                      store.showToast(
                        error instanceof Error ? error.message : String(error)
                      )
                    )
                }
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
                aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                title={
                  isFullscreen ? "Exit fullscreen (F11)" : "Fullscreen (F11)"
                }
              >
                {isFullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
        </header>

        <main className="relative flex min-h-0 flex-1 overflow-x-hidden overflow-y-hidden">
          <div
            key={mainView}
            className={`flex h-full min-h-0 min-w-0 flex-1 ${
              mainView === "excalidraw" ? "" : "workspace-view-enter"
            }`}
          >
            {mainView === "excalidraw" ? (
              activeWorkspace ? (
                <Suspense
                  fallback={
                    <div className="flex flex-1 items-center justify-center text-xs text-[var(--color-muted)]">
                      Loading Excalidraw…
                    </div>
                  }
                >
                  <ExcalidrawWorkspace
                    workspaceId={activeWorkspace.id}
                    selectedNode={selectedNode}
                    nodes={store.nodes}
                    appearanceMode={store.preferences.appearanceMode}
                    isFullscreen={isExcalidrawFullscreen}
                    onSelectNode={(nodeId) => store.selectNode(nodeId)}
                    onToast={store.showToast}
                  />
                </Suspense>
              ) : (
                <div className="flex flex-1 items-center justify-center p-8 text-center">
                  <p className="max-w-sm text-xs leading-5 text-[var(--color-muted)]">
                    Select or create a workspace before opening Excalidraw boards.
                  </p>
                </div>
              )
            ) : (
              store.nodes.length === 0 ? (
                <div
                  data-guide="canvas"
                  className="flex flex-1 flex-col items-center justify-center p-8 text-center"
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
                    Learning studio
                  </p>
                  <h2 className="mt-3 text-xl font-semibold tracking-tight">
                    No curriculum yet
                  </h2>
                  <div className="mt-5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => store.setActiveModal("new_workspace")}
                      className="rounded-lg bg-[var(--color-accent-button)] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-95"
                    >
                      New DAG
                    </button>
                    <button
                      type="button"
                      onClick={() => store.setActiveModal("vault")}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2.5 text-xs font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
                    >
                      Add notes
                    </button>
                  </div>
                </div>
              ) : (
                <div data-guide="canvas" className="min-w-0 flex-1">
                  <DagCanvas
                    workspaceId={activeWorkspace?.id ?? null}
                    nodes={store.nodes}
                    edges={store.edges}
                    layoutMode={activeWorkspace?.layout_mode ?? "auto"}
                    selectedNodeId={store.selectedNodeId}
                    showDots={store.preferences.showCanvasDots}
                    edgeRouting={store.preferences.edgeRouting}
                    nodeDensity={store.preferences.nodeDensity}
                    onSelectNode={(id) => store.selectNode(id)}
                    quizNodeIds={store.quizNodeIds}
                    onSetLayoutMode={store.setCanvasLayoutMode}
                    onMoveNode={store.moveGraphNode}
                    onRealignGrid={store.realignGraphGrid}
                    onAddNode={store.addConceptNode}
                    onEditNode={store.editConceptNode}
                    onArchiveNode={store.archiveConceptNode}
                    onRestoreArchivedNode={store.restoreArchivedConceptNode}
                    onPermanentlyDeleteArchivedNode={
                      store.permanentlyDeleteArchivedConceptNode
                    }
                    onConnectNodes={store.connectConceptNodes}
                    onDisconnectNodes={store.disconnectConceptNodes}
                    onToast={store.showToast}
                  />
                </div>
              )
            )}
          </div>

          <div
            className="right-drawer-track pointer-events-none absolute inset-0 z-20 overflow-hidden"
            aria-label="Lesson and tutor panels"
          >
            {lessonNode && (
              <Suspense fallback={null}>
                <LessonReader
                  node={lessonNode}
                  theme={store.preferences.theme}
                  isOpen={
                    mainView === "graph"
                      ? Boolean(selectedNode)
                      : isExcalidrawLessonOpen
                  }
                  companionOpen={store.isTutorOpen && tutorPanelReady}
                  isHydrating={store.hydratingNodeIds.has(lessonNode.id)}
                  hydrationError={
                    store.hydrationErrors.get(lessonNode.id) ?? null
                  }
                  hasSavedQuiz={store.quizNodeIds.has(lessonNode.id)}
                  isQuizAvailabilityLoaded={store.checkedQuizNodeIds.has(
                    lessonNode.id
                  )}
                  onClose={() => {
                    if (mainView === "graph") {
                      void store.selectNode(null);
                    } else {
                      setIsExcalidrawLessonOpen(false);
                    }
                  }}
                  onRetryHydration={() =>
                    lessonNode.is_hydrated === 1
                      ? void store.regenerateNodeLesson(lessonNode.id)
                      : void store.selectNode(lessonNode.id)
                  }
                  onRegenerateLesson={() =>
                    void store.regenerateNodeLesson(lessonNode.id)
                  }
                  onRequestCompletion={(id) => {
                    if (store.selectedNodeId === id) {
                      store.setActiveModal("completion");
                    }
                  }}
                  onStartDiagnostic={(id) =>
                    store.openDiagnosticForNode(id)
                  }
                  onOpenVisualBoard={
                    excalidrawEnabled ? openLessonVisualBoard : undefined
                  }
                  onToast={(message) => store.showToast(message)}
                />
              </Suspense>
            )}

            {hasOpenedTutor && (
              <Suspense fallback={null}>
                <TutorDrawer
                  isOpen={store.isTutorOpen}
                  activeLesson={
                    mainView === "excalidraw" ? lessonNode : selectedNode
                  }
                  activeNodeTitle={
                    (mainView === "excalidraw" ? lessonNode : selectedNode)
                      ?.title
                  }
                  workspaceId={store.activeWorkspaceId}
                  onPanelReady={() => setTutorPanelReady(true)}
                  onClose={() => store.setTutorOpen(false)}
                  onToast={store.showToast}
                />
              </Suspense>
            )}
          </div>

          <AnimatedPresence
            present={Boolean(store.toastMessage)}
            motion="toast"
            className="pointer-events-none fixed bottom-5 right-5 z-50"
            exitDuration={170}
          >
            {store.toastMessage ? (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2.5 text-xs font-medium text-[var(--color-ink)] shadow-[0_12px_36px_rgba(31,43,51,0.14)]">
                {store.toastMessage}
              </div>
            ) : null}
          </AnimatedPresence>
        </main>
            </div>
          </div>

          {(hasOpenedModal || store.activeModal !== "none") && (
            <Suspense fallback={null}>
              <Modals
            activeModal={store.activeModal}
            activeWorkspaceId={store.activeWorkspaceId}
            selectedNodeId={store.selectedNodeId}
            selectedNodeTitle={selectedNode?.title ?? ""}
            theme={store.preferences.theme}
            isGeneratingCurriculum={store.isGeneratingCurriculum}
            curriculumProgress={store.curriculumProgress}
            masteryPassThreshold={store.preferences.masteryPassThreshold}
            dueCards={store.dueCards}
            documents={store.documents}
            diagnosticQuestions={store.diagnosticQuestions}
            diagnosticConfig={store.diagnosticConfig}
            diagnosticDraft={store.diagnosticDraft}
            diagnosticScore={store.diagnosticScore}
            isLoadingDiagnostic={store.isLoadingDiagnostic}
            isGeneratingDiagnostic={Boolean(store.diagnosticAbortController)}
            diagnosticProgress={store.diagnosticProgress}
            isSubmittingDiagnostic={store.isSubmittingDiagnostic}
            isConfiguringDiagnostic={store.isConfiguringDiagnostic}
            diagnosticError={store.diagnosticError}
            onClose={() => store.setActiveModal("none")}
            onGenerateCurriculum={(topic, sourceDocument) =>
              store.generateNewCurriculum(topic, sourceDocument)
            }
            onCancelCurriculum={() => store.cancelCurriculumGeneration()}
            onGradeCard={(card, grade) => store.gradeDueCard(card, grade)}
            onStartDiagnostic={(nodeId) =>
              store.openDiagnosticForNode(nodeId)
            }
            onConfigureDiagnostic={(nodeId) =>
              store.configureDiagnosticForNode(nodeId)
            }
            onCancelDiagnosticConfiguration={() =>
              store.cancelDiagnosticConfiguration()
            }
            onCancelDiagnosticGeneration={() =>
              store.cancelDiagnosticGeneration()
            }
            onGenerateDiagnostic={(nodeId, config) =>
              store.generateConfiguredDiagnostic(nodeId, config)
            }
            onSaveDiagnosticDraft={(nodeId, draft) =>
              store.saveDiagnosticDraft(nodeId, draft)
            }
            onResetDiagnosticAttempt={(nodeId) =>
              store.resetDiagnosticAttempt(nodeId)
            }
            onSubmitDiagnostic={(nodeId, answers, languages) =>
              store.submitDiagnostic(nodeId, answers, languages)
            }
            onQuizCacheCleared={() => store.clearQuizAvailability()}
            onCompleteNode={(nodeId) =>
              store.markNodeMastered(nodeId, 1)
            }
            onRefreshDocuments={() => store.refreshDocuments()}
            onRemoveDocument={(docId) => store.removeDocument(docId)}
            onToast={(message) => store.showToast(message)}
              />
            </Suspense>
          )}

          {(hasOpenedGuide || isGuideOpen) && (
            <AppGuide
              isOpen={isGuideOpen}
              onClose={closeGuide}
              showOnStartup={store.preferences.showAppTutorial}
              onShowOnStartupChange={setGuideOnStartup}
            />
          )}
        </>
      ) : null}
      <BootSplash
        ready={dbReady || Boolean(bootError)}
        status={bootError ? "Local vault unavailable" : undefined}
      />
    </div>
  );
}
