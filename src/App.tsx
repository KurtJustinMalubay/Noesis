import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Bot, Maximize2, Minimize2 } from "lucide-react";
import { getDb } from "./db/client";
import { useNoesisStore } from "./store/useNoesisStore";
import { DagCanvas } from "./components/DagCanvas";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { AppGuide } from "./components/AppGuide";
import { AnimatedPresence } from "./components/AnimatedPresence";
import { BootSplash } from "./components/BootSplash";
import type { GraphNode } from "./types/domain";
import {
  setNativeFullscreen,
  toggleNativeFullscreen,
} from "./utils/windowControls";

const TUTORIAL_SEEN_KEY = "noesis.app-guide.seen.v1";

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

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [hasOpenedTutor, setHasOpenedTutor] = useState(false);
  const [tutorPanelReady, setTutorPanelReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMotion, setSidebarMotion] = useState<
    "collapse" | "expand" | null
  >(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasOpenedGuide, setHasOpenedGuide] = useState(false);
  const [hasOpenedModal, setHasOpenedModal] = useState(false);
  const sidebarCollapsedRef = useRef(false);
  const launchFullscreenApplied = useRef(false);
  const lastSelectedNodeRef = useRef<GraphNode | null>(null);
  const store = useNoesisStore();
  const toggleSidebar = () => {
    const nextCollapsed = !sidebarCollapsedRef.current;
    sidebarCollapsedRef.current = nextCollapsed;
    setSidebarCollapsed(nextCollapsed);
    setSidebarMotion(nextCollapsed ? "collapse" : "expand");
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
    if (isGuideOpen) setHasOpenedGuide(true);
  }, [isGuideOpen]);

  useEffect(() => {
    if (!store.preferences.showAppTutorial) {
      setIsGuideOpen(false);
      return;
    }
    if (
      dbReady &&
      store.activeModal === "none" &&
      localStorage.getItem(TUTORIAL_SEEN_KEY) !== "true"
    ) {
      setIsGuideOpen(true);
    }
  }, [dbReady, store.activeModal, store.preferences.showAppTutorial]);

  const closeGuide = () => {
    localStorage.setItem(TUTORIAL_SEEN_KEY, "true");
    setIsGuideOpen(false);
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
              activeWorkspaceId={store.activeWorkspaceId}
              nodes={store.nodes}
              dueCount={store.dueCards.length}
              documentCount={store.documents.length}
              onToggle={toggleSidebar}
              onSelect={(id) => store.selectWorkspace(id)}
              onDelete={(id) => store.removeWorkspace(id)}
              onNewDag={() => store.setActiveModal("new_workspace")}
              onVault={() => store.setActiveModal("vault")}
              onReview={() => store.setActiveModal("review")}
              onGuide={() => setIsGuideOpen(true)}
              onSettings={() => store.setActiveModal("settings")}
              onToast={(message) => store.showToast(message)}
            />

            <div
              className="flex min-w-0 flex-1 flex-col"
              data-sidebar-motion={sidebarMotion ?? undefined}
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
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setHasOpenedTutor(true);
                store.setTutorOpen(!store.isTutorOpen);
              }}
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
              title={isFullscreen ? "Exit fullscreen (F11)" : "Fullscreen (F11)"}
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
          {store.nodes.length === 0 ? (
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
                nodes={store.nodes}
                edges={store.edges}
                selectedNodeId={store.selectedNodeId}
                showDots={store.preferences.showCanvasDots}
                edgeRouting={store.preferences.edgeRouting}
                nodeDensity={store.preferences.nodeDensity}
                onSelectNode={(id) => store.selectNode(id)}
              />
            </div>
          )}

          <div
            className="right-drawer-track pointer-events-none absolute inset-0 z-20 overflow-hidden"
            aria-label="Lesson and tutor panels"
          >
            {lessonNode && (
              <Suspense fallback={null}>
                <LessonReader
                  node={lessonNode}
                  theme={store.preferences.theme}
                  isOpen={Boolean(selectedNode)}
                  companionOpen={store.isTutorOpen && tutorPanelReady}
                  isHydrating={store.hydratingNodeIds.has(lessonNode.id)}
                  hydrationError={
                    store.hydrationErrors.get(lessonNode.id) ?? null
                  }
                  hasSavedQuiz={store.quizNodeIds.has(lessonNode.id)}
                  isQuizAvailabilityLoaded={store.checkedQuizNodeIds.has(
                    lessonNode.id
                  )}
                  onClose={() => store.selectNode(null)}
                  onRetryHydration={() =>
                    void store.selectNode(lessonNode.id)
                  }
                  onRequestCompletion={(id) => {
                    if (store.selectedNodeId === id) {
                      store.setActiveModal("completion");
                    }
                  }}
                  onStartDiagnostic={(id) => store.openDiagnosticForNode(id)}
                />
              </Suspense>
            )}

            {hasOpenedTutor && (
              <Suspense fallback={null}>
                <TutorDrawer
                  isOpen={store.isTutorOpen}
                  activeLesson={selectedNode}
                  activeNodeTitle={selectedNode?.title}
                  workspaceId={store.activeWorkspaceId}
                  onPanelReady={() => setTutorPanelReady(true)}
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
            isSubmittingDiagnostic={store.isSubmittingDiagnostic}
            isConfiguringDiagnostic={store.isConfiguringDiagnostic}
            diagnosticError={store.diagnosticError}
            onClose={() => store.setActiveModal("none")}
            onGenerateCurriculum={(topic) => store.generateNewCurriculum(topic)}
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
            <AppGuide isOpen={isGuideOpen} onClose={closeGuide} />
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
