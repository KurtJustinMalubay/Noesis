import {
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  CalendarDays,
  GitBranch,
  LayoutDashboard,
  Moon,
  Network,
  Shapes,
  Sun,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { getDb } from "./db/client";
import { useNoesisStore } from "./store/useNoesisStore";
import { usePluginStore } from "./plugins/pluginStore";
import {
  AI_USAGE_PLUGIN_ID,
  EXCALIDRAW_PLUGIN_ID,
  FLASHCARDS_PLUGIN_ID,
  STUDY_CALENDAR_PLUGIN_ID,
} from "./plugins/registry";
import { DagCanvas } from "./components/DagCanvas";
import { DashboardView } from "./components/DashboardView";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { ExitConfirmationModal } from "./components/ExitConfirmationModal";
import {
  AppGuide,
  type SettingsTourSection,
} from "./components/AppGuide";
import { AnimatedPresence } from "./components/AnimatedPresence";
import { BootSplash } from "./components/BootSplash";
import { UpdateIndicator } from "./components/UpdateIndicator";
import { NotificationConsentModal } from "./components/NotificationConsentModal";
import type {
  CurriculumTree,
  CurriculumTreeNode,
  GraphEdge,
  GraphNode,
} from "./types/domain";
import type { WorkspaceProgressSummary } from "./db/repositories/workspaceRepo";
import {
  buildDashboardContextSummary,
  getDashboardSnapshot,
  getGlobalDueFlashcardCount,
  type DashboardSnapshot,
} from "./db/repositories/dashboardRepo";
import {
  getReviewsCompletedToday,
  getWeeklyReviewConsistency,
  type UserPreferences,
} from "./ai/keyStore";
import {
  AI_USAGE_UPDATED_EVENT,
  getAiUsageSummary,
  type AiUsageSummary,
} from "./ai/usage";
import { getWorkspaceDeletionSummary } from "./db/repositories/workspaceRepo";
import {
  createPluginBoard,
  listPluginBoards,
} from "./db/repositories/pluginBoardRepo";
import {
  setNativeFullscreen,
  toggleNativeFullscreen,
} from "./utils/windowControls";
import { CurriculumTreeDagView as CurriculumTreeView } from "./components/CurriculumTreeDagView";
import {
  archiveCurriculumTree,
  deleteCurriculumTree,
  linkCurriculumTreeWorkspace,
  renameCurriculumTree,
  restoreCurriculumTree,
} from "./db/repositories/curriculumTreeRepo";
import { getCalendarEvents } from "./db/repositories/calendarRepo";
import { toLocalIsoDate, addIsoDays } from "./calendar/dateUtils";
import {
  CALENDAR_REMINDER_GRACE_MS,
  getDueCalendarReminders,
} from "./calendar/reminders";
import type { CalendarEvent } from "./calendar/types";
import { getUnarchivedWorkspaces } from "./utils/workspaceArchive";
import {
  getImportantAppNotification,
  grantNativeNotificationConsent,
  hasNativeNotificationConsent,
  sendNativeNotification,
} from "./utils/nativeNotifications";
import StudyCalendarView from "./components/StudyCalendarView";
import { MiniAgendaView } from "./components/MiniAgendaView";

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

const GUIDE_NODES: GraphNode[] = [
  {
    id: "guide-foundation",
    workspace_id: "guide-preview",
    title: "Learning science",
    summary_hint: "How people learn and remember",
    status: "unlocked",
    mastery_score: 0,
    in_degree_unmastered: 0,
    layer_index: 0,
    pos_x: 147,
    pos_y: 0,
    is_hydrated: 0,
    lesson_markdown: null,
    mermaid_diagram: null,
    source_citations: null,
    updated_at: 0,
    archived_at: null,
  },
  {
    id: "guide-attention",
    workspace_id: "guide-preview",
    title: "Attention",
    summary_hint: "Focus and distractions",
    status: "locked",
    mastery_score: 0,
    in_degree_unmastered: 1,
    layer_index: 1,
    pos_x: 0,
    pos_y: 206,
    is_hydrated: 0,
    lesson_markdown: null,
    mermaid_diagram: null,
    source_citations: null,
    updated_at: 0,
    archived_at: null,
  },
  {
    id: "guide-memory",
    workspace_id: "guide-preview",
    title: "Working memory",
    summary_hint: "How we hold information in mind",
    status: "locked",
    mastery_score: 0,
    in_degree_unmastered: 1,
    layer_index: 1,
    pos_x: 294,
    pos_y: 206,
    is_hydrated: 0,
    lesson_markdown: null,
    mermaid_diagram: null,
    source_citations: null,
    updated_at: 0,
    archived_at: null,
  },
  {
    id: "guide-recall",
    workspace_id: "guide-preview",
    title: "Active recall",
    summary_hint: "Practice retrieving what you learned",
    status: "locked",
    mastery_score: 0,
    in_degree_unmastered: 2,
    layer_index: 2,
    pos_x: 147,
    pos_y: 412,
    is_hydrated: 0,
    lesson_markdown: null,
    mermaid_diagram: null,
    source_citations: null,
    updated_at: 0,
    archived_at: null,
  },
];

const GUIDE_EDGES: GraphEdge[] = [
  {
    workspace_id: "guide-preview",
    source_id: "guide-foundation",
    target_id: "guide-attention",
  },
  {
    workspace_id: "guide-preview",
    source_id: "guide-foundation",
    target_id: "guide-memory",
  },
  {
    workspace_id: "guide-preview",
    source_id: "guide-attention",
    target_id: "guide-recall",
  },
  {
    workspace_id: "guide-preview",
    source_id: "guide-memory",
    target_id: "guide-recall",
  },
];

function MainApp() {
  const [dbReady, setDbReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [hasOpenedTutor, setHasOpenedTutor] = useState(false);
  const [tutorPanelReady, setTutorPanelReady] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [excalidrawSidebarTarget, setExcalidrawSidebarTarget] =
    useState<HTMLDivElement | null>(null);
  const [excalidrawCreateBoardRequest, setExcalidrawCreateBoardRequest] =
    useState(0);
  const [excalidrawBoardSearchQuery, setExcalidrawBoardSearchQuery] =
    useState("");
  const [mainView, setMainView] = useState<
    "dashboard" | "graph" | "excalidraw" | "curriculum" | "calendar"
  >("dashboard");
  const [dashboardSnapshot, setDashboardSnapshot] =
    useState<DashboardSnapshot | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [aiUsage, setAiUsage] = useState<AiUsageSummary>(() =>
    getAiUsageSummary()
  );
  const [globalDueCount, setGlobalDueCount] = useState(0);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  const [curriculumTrees, setCurriculumTrees] = useState<CurriculumTree[]>([]);
  const [archivedCurriculumTrees, setArchivedCurriculumTrees] = useState<
    CurriculumTree[]
  >([]);
  const [selectedCurriculumTreeId, setSelectedCurriculumTreeId] = useState<
    string | null
  >(null);
  const [curriculumProgress, setCurriculumProgress] =
    useState<WorkspaceProgressSummary>({
      nodeCount: 0,
      masteredCount: 0,
    });
  const [isCreatingCurriculumTree, setIsCreatingCurriculumTree] =
    useState(false);
  const [isExitConfirmationOpen, setIsExitConfirmationOpen] = useState(false);
  const [settingsGuideRequest, setSettingsGuideRequest] = useState<{
    section: SettingsTourSection;
    requestId: number;
  } | null>(null);
  const [settingsCloseRequest, setSettingsCloseRequest] = useState(0);
  const [newWorkspacePrompt, setNewWorkspacePrompt] = useState("");
  const [isExcalidrawLessonOpen, setIsExcalidrawLessonOpen] = useState(false);
  const [lessonBoardOpenRequest, setLessonBoardOpenRequest] = useState<{
    workspaceId: string;
    nodeId: string;
    requestId: number;
  } | null>(null);
  const lessonBoardRequestIdRef = useRef(0);
  const [sidebarMotion, setSidebarMotion] = useState<
    "collapse" | "expand" | null
  >(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [nativeNotificationsEnabled, setNativeNotificationsEnabled] = useState(
    () => hasNativeNotificationConsent()
  );
  const [isNotificationConsentOpen, setIsNotificationConsentOpen] =
    useState(false);
  const [notificationConsentError, setNotificationConsentError] = useState<
    string | null
  >(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasOpenedGuide, setHasOpenedGuide] = useState(false);
  const [hasOpenedModal, setHasOpenedModal] = useState(false);
  const pendingViewAfterWorkspaceSelectRef = useRef<
    "dashboard" | "graph" | "curriculum" | "excalidraw" | null
  >(null);
  const bootedWorkspaceRef = useRef(false);
  const prevMainViewRef = useRef<
    "dashboard" | "graph" | "excalidraw" | "curriculum" | "calendar"
  >("dashboard");
  const sidebarCollapsedRef = useRef(true);
  const sidebarBeforeDashboardRef = useRef<boolean | null>(false);
  const startupGuideEvaluated = useRef(false);
  const profilePromptEvaluated = useRef(false);
  const launchFullscreenApplied = useRef(false);
  const checkingCalendarReminders = useRef(false);
  const notificationPromptDismissed = useRef(false);
  const nativeNotificationsEnabledRef = useRef(nativeNotificationsEnabled);
  nativeNotificationsEnabledRef.current = nativeNotificationsEnabled;
  const pendingCurriculumNodeRef = useRef<CurriculumTreeNode | null>(null);
  const lastSelectedNodeRef = useRef<GraphNode | null>(null);
  const setExcalidrawSidebarSlot = useCallback(
    (element: HTMLDivElement | null) => setExcalidrawSidebarTarget(element),
    []
  );
  const store = useNoesisStore();
  const promptForNativeNotifications = useCallback(() => {
    if (
      !isTauri() ||
      nativeNotificationsEnabledRef.current ||
      notificationPromptDismissed.current
    ) {
      return;
    }
    notificationPromptDismissed.current = true;
    setNotificationConsentError(null);
    setIsNotificationConsentOpen(true);
  }, []);
  const activeWorkspaces = useMemo(
    () => getUnarchivedWorkspaces(store.workspaces),
    [store.workspaces]
  );
  const activeWorkspaceIdRef = useRef(store.activeWorkspaceId);
  const enabledPluginIds = usePluginStore((state) => state.enabledPluginIds);
  const excalidrawEnabled = enabledPluginIds.includes(EXCALIDRAW_PLUGIN_ID);
  const flashcardsEnabled = enabledPluginIds.includes(FLASHCARDS_PLUGIN_ID);
  const aiUsageEnabled = enabledPluginIds.includes(AI_USAGE_PLUGIN_ID);
  const studyCalendarEnabled = enabledPluginIds.includes(
    STUDY_CALENDAR_PLUGIN_ID
  );

  useEffect(() => {
    const notification = store.toastMessage
      ? getImportantAppNotification(store.toastMessage)
      : null;
    if (!notification) return;
    void sendNativeNotification(notification.title, notification.body);
  }, [store.toastMessage]);
  const isSidebarLockedView =
    mainView === "dashboard" || mainView === "calendar";
  const sidebarLockedViewRef = useRef(isSidebarLockedView);
  sidebarLockedViewRef.current = isSidebarLockedView;
  const settingsGuideRequestId = useRef(0);
  const openSettingsSectionFromGuide = useCallback(
    (section: SettingsTourSection) => {
      setSettingsGuideRequest({
        section,
        requestId: ++settingsGuideRequestId.current,
      });
      store.setActiveModal("settings");
    },
    [store.setActiveModal]
  );
  const closeSettingsFromGuide = useCallback(() => {
    setSettingsGuideRequest(null);
    setSettingsCloseRequest((request) => request + 1);
  }, []);
  const navigateGuideToView = useCallback(
    (view: "dashboard" | "graph" | "curriculum" | "calendar") => {
      setMainView(view);
      if (view === "calendar") {
        promptForNativeNotifications();
      }
    },
    [promptForNativeNotifications]
  );
  const enableNativeNotifications = useCallback(() => {
    if (!grantNativeNotificationConsent()) {
      setNotificationConsentError(
        "Could not save your notification choice. Check local app storage and try again."
      );
      return;
    }

    setNotificationConsentError(null);
    nativeNotificationsEnabledRef.current = true;
    setNativeNotificationsEnabled(true);
    setIsNotificationConsentOpen(false);
    store.showToast("Native notifications are enabled.");
  }, [store.showToast]);
  const requestExitConfirmation = useCallback(
    () => setIsExitConfirmationOpen(true),
    []
  );
  const updateCurriculumProgress = useCallback(
    (progress: WorkspaceProgressSummary) => setCurriculumProgress(progress),
    []
  );

  useEffect(() => {
    const refreshAiUsage = () => setAiUsage(getAiUsageSummary());
    window.addEventListener(AI_USAGE_UPDATED_EVENT, refreshAiUsage);
    refreshAiUsage();
    return () =>
      window.removeEventListener(AI_USAGE_UPDATED_EVENT, refreshAiUsage);
  }, []);

  useEffect(() => {
    if (!dbReady) return;
    let cancelled = false;
    void getGlobalDueFlashcardCount()
      .then((count) => {
        if (!cancelled) setGlobalDueCount(count);
      })
      .catch(() => {
        // Keep previous global due count if a transient read fails.
      });
    return () => {
      cancelled = true;
    };
  }, [
    dbReady,
    store.workspaces.length,
    store.nodes.length,
    store.dueCards.length,
    store.activeModal,
  ]);

  useEffect(() => {
    if (!dbReady || mainView !== "dashboard") return;
    let cancelled = false;
    setIsDashboardLoading(true);
    void getDashboardSnapshot()
      .then((snapshot) => {
        if (!cancelled) {
          setDashboardSnapshot(snapshot);
          setGlobalDueCount(snapshot.totals.dueFlashcardCount);
        }
      })
      .catch(() => {
        // Keep the previous snapshot if a transient refresh fails.
      })
      .finally(() => {
        if (!cancelled) setIsDashboardLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    dbReady,
    mainView,
    store.workspaces.length,
    store.nodes.length,
    store.dueCards.length,
    curriculumTrees.length,
    store.activeModal,
  ]);

  useEffect(() => {
    if (!isTauri() || studyCalendarEnabled) return;
    void invoke("close_mini_agenda_window").catch((error: unknown) =>
      store.showToast(
        `Unable to close the Mini Agenda: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    );
  }, [studyCalendarEnabled, store.showToast]);

  useEffect(() => {
    if (!dbReady || !studyCalendarEnabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<{ workspaceId: string; nodeId: string }>(
      "calendar:open-quiz",
      async ({ payload }) => {
        try {
          await store.selectWorkspace(payload.workspaceId);
          await store.selectNode(payload.nodeId);
          await store.openDiagnosticForNode(payload.nodeId);
          setMainView("graph");
        } catch (error) {
          store.showToast(
            `Unable to open the scheduled quiz: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    )
      .then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      })
      .catch((error: unknown) =>
        store.showToast(
          `Unable to listen for scheduled quiz actions: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [
    dbReady,
    store.openDiagnosticForNode,
    store.selectNode,
    store.selectWorkspace,
    store.showToast,
    studyCalendarEnabled,
  ]);

  useEffect(() => {
    if (!dbReady || !studyCalendarEnabled) {
      setCalendarEvents([]);
      return;
    }

    let cancelled = false;
    const refreshCalendarData = async () => {
      const startDate = toLocalIsoDate(new Date());
      const endDate = addIsoDays(startDate, 42);
      try {
        const events = await getCalendarEvents(startDate, endDate);
        if (!cancelled) setCalendarEvents(events);
      } catch (error) {
        if (!cancelled) {
          store.showToast(
            `Unable to load Study Calendar data: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    };

    void refreshCalendarData();
    let unlisten: (() => void) | undefined;
    void listen("calendar:updated", () => void refreshCalendarData())
      .then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      })
      .catch((error: unknown) =>
        store.showToast(
          `Unable to listen for calendar updates: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [dbReady, studyCalendarEnabled, store.showToast]);

  useEffect(() => {
    if (!dbReady || !studyCalendarEnabled || calendarEvents.length === 0) {
      return;
    }

    let active = true;
    const checkReminders = async () => {
      if (checkingCalendarReminders.current) return;
      checkingCalendarReminders.current = true;
      try {
        let sentKeys = new Set<string>();
        try {
          const serialized = localStorage.getItem(
            "noesis.calendar.reminder-sent.v1"
          );
          const stored = JSON.parse(serialized ?? "[]");
          if (!Array.isArray(stored)) {
            throw new Error("Stored calendar reminder keys are not an array.");
          }
          sentKeys = new Set(
            stored.filter((key): key is string => typeof key === "string")
          );
        } catch (error) {
          console.error("Could not read sent calendar reminders.", error);
        }

        const dueReminders = getDueCalendarReminders(
          calendarEvents,
          new Date(),
          sentKeys
        );
        for (const reminder of dueReminders) {
          if (!active) return;
          if (
            Date.now() - reminder.fireAt >
            CALENDAR_REMINDER_GRACE_MS
          ) {
            continue;
          }
          if (
            await sendNativeNotification(
              reminder.title,
              reminder.body
            )
          ) {
            sentKeys.add(reminder.key);
            try {
              localStorage.setItem(
                "noesis.calendar.reminder-sent.v1",
                JSON.stringify([...sentKeys].slice(-256))
              );
            } catch (error) {
              console.error("Could not save sent calendar reminders.", error);
            }
          }
        }
      } finally {
        checkingCalendarReminders.current = false;
      }
    };

    void checkReminders();
    const intervalId = window.setInterval(() => void checkReminders(), 15_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [calendarEvents, dbReady, studyCalendarEnabled]);

  const weeklyConsistency = useMemo(
    () => getWeeklyReviewConsistency(),
    [
      mainView,
      dashboardSnapshot,
      store.dueCards.length,
      store.activeModal,
    ]
  );

  const openGlobalReviewQueue = useCallback(async () => {
    if (store.dueCards.length === 0) {
      const dueWorkspace = dashboardSnapshot?.workspaces.find(
        (ws) => ws.dueFlashcardCount > 0
      );
      if (dueWorkspace && dueWorkspace.id !== store.activeWorkspaceId) {
        if (mainView === "dashboard") {
          pendingViewAfterWorkspaceSelectRef.current = "dashboard";
        }
        await store.selectWorkspace(dueWorkspace.id);
      }
    }
    store.setActiveModal("review");
  }, [
    dashboardSnapshot,
    mainView,
    store.activeWorkspaceId,
    store.dueCards.length,
    store.selectWorkspace,
    store.setActiveModal,
  ]);

  const dashboardContext = useMemo(() => {
    if (mainView !== "dashboard" || !dashboardSnapshot) return null;
    return buildDashboardContextSummary(
      dashboardSnapshot,
      getReviewsCompletedToday(),
      store.preferences.dailyReviewLimit
    );
  }, [mainView, dashboardSnapshot, store.preferences.dailyReviewLimit]);

  const nextDeadline = useMemo(() => {
    if (!studyCalendarEnabled) return null;
    const today = toLocalIsoDate(new Date());
    const latest = addIsoDays(today, 7);
    return (
      calendarEvents
        .filter(
          (event) =>
            !event.isCompleted &&
            (event.eventType === "exam" || event.eventType === "deadline") &&
            event.dueDate >= today &&
            event.dueDate <= latest
        )
        .sort(
          (left, right) =>
            left.dueDate.localeCompare(right.dueDate) ||
            (left.dueTime ?? "").localeCompare(right.dueTime ?? "")
        )[0] ?? null
    );
  }, [calendarEvents, studyCalendarEnabled]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        requestExitConfirmation();
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error: unknown) =>
        store.showToast(
          `Could not enable the close warning: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [requestExitConfirmation, store.showToast]);
  const toggleSidebar = () => {
    if (sidebarLockedViewRef.current) return;
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
  const openExcalidrawView = () => {
    if (sidebarCollapsedRef.current) {
      sidebarCollapsedRef.current = false;
      setSidebarCollapsed(false);
    }
    setMainView("excalidraw");
  };
  const openTopBarView = async (
    targetView: "graph" | "curriculum" | "excalidraw"
  ) => {
    if (mainView === "dashboard" && !activeWorkspace) {
      if (activeWorkspaces.length > 0) {
        pendingViewAfterWorkspaceSelectRef.current = targetView;
        if (targetView === "excalidraw" && !sidebarCollapsedRef.current) {
          sidebarCollapsedRef.current = true;
          setSidebarCollapsed(true);
        }
        await store.selectWorkspace(activeWorkspaces[0].id);
        if (targetView === "excalidraw") {
          openExcalidrawView();
        } else {
          setMainView(targetView);
        }
        return;
      }
      store.setActiveModal("new_workspace");
      return;
    }

    if (targetView === "excalidraw") {
      openExcalidrawView();
    } else {
      setMainView(targetView);
    }
  };
  const linkPendingCurriculumWorkspace = async () => {
    const node = pendingCurriculumNodeRef.current;
    const workspaceId = useNoesisStore.getState().activeWorkspaceId;
    if (!node || !workspaceId) return;
    await linkCurriculumTreeWorkspace(node.tree_id, node.id, workspaceId);
    pendingCurriculumNodeRef.current = null;
    setNewWorkspacePrompt("");
    store.showToast(`Linked "${node.title}" to its new workspace.`);
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
    document.documentElement.setAttribute(
      "data-high-contrast-text",
      String(store.preferences.highContrastText)
    );
    document.documentElement.setAttribute(
      "data-reduced-motion",
      String(store.preferences.reduceMotion)
    );
  }, [
    store.preferences.theme,
    store.preferences.highContrastText,
    store.preferences.reduceMotion,
  ]);

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
      const currentStore = useNoesisStore.getState();
      const target = event.target;
      const isEditingText =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          Boolean(
            target.closest("input, textarea, select, [contenteditable='true']")
          ));
      if (isEditingText) return;
      if (event.ctrlKey && event.key.toLowerCase() === "z") {
        if (currentStore.activeModal !== "none") return;
        event.preventDefault();
        const action = event.shiftKey
          ? currentStore.redoGraph
          : currentStore.undoGraph;
        void action().catch((error: unknown) =>
          currentStore.showToast(
            error instanceof Error ? error.message : String(error)
          )
        );
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "y") {
        if (currentStore.activeModal !== "none") return;
        event.preventDefault();
        void currentStore.redoGraph().catch((error: unknown) =>
          currentStore.showToast(
            error instanceof Error ? error.message : String(error)
          )
        );
        return;
      }
      if (
        event.key === "F11" ||
        (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f")
      ) {
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
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        store.setActiveModal("new_workspace");
        return;
      }
      if (event.ctrlKey && event.key === ",") {
        event.preventDefault();
        store.setActiveModal("settings");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (store.activeModal !== "none") setHasOpenedModal(true);
  }, [store.activeModal]);

  useEffect(() => {
    if (!excalidrawEnabled && mainView === "excalidraw") {
      setMainView("graph");
    }
  }, [excalidrawEnabled, mainView]);

  useEffect(() => {
    if (!dbReady) return;
    if (!bootedWorkspaceRef.current) {
      bootedWorkspaceRef.current = true;
      activeWorkspaceIdRef.current = store.activeWorkspaceId;
      return;
    }
    if (activeWorkspaceIdRef.current === store.activeWorkspaceId) return;
    activeWorkspaceIdRef.current = store.activeWorkspaceId;
    setLessonBoardOpenRequest(null);
    const nextView = pendingViewAfterWorkspaceSelectRef.current ?? "graph";
    pendingViewAfterWorkspaceSelectRef.current = null;
    setMainView(nextView);
  }, [dbReady, store.activeWorkspaceId]);

  useEffect(() => {
    const prevView = prevMainViewRef.current;
    prevMainViewRef.current = mainView;

    if (mainView !== "excalidraw") {
      const wasSidebarLockedView =
        prevView === "dashboard" || prevView === "calendar";
      if (isSidebarLockedView) {
        if (!wasSidebarLockedView) {
          sidebarBeforeDashboardRef.current =
            prevView === "excalidraw" ? false : sidebarCollapsedRef.current;
        }
        if (!sidebarCollapsedRef.current) {
          sidebarCollapsedRef.current = true;
          setSidebarCollapsed(true);
        }
      } else if (wasSidebarLockedView) {
        const restoreState = sidebarBeforeDashboardRef.current;
        sidebarBeforeDashboardRef.current = null;
        if (
          restoreState !== null &&
          restoreState !== sidebarCollapsedRef.current
        ) {
          sidebarCollapsedRef.current = restoreState;
          setSidebarCollapsed(restoreState);
        }
      }
    }
  }, [isSidebarLockedView, mainView]);

  useEffect(() => {
    if (mainView === "excalidraw") setSidebarMotion(null);
  }, [mainView]);

  useEffect(() => {
    if (!sidebarMotion) return;
    const fallback = window.setTimeout(() => setSidebarMotion(null), 450);
    return () => window.clearTimeout(fallback);
  }, [sidebarMotion]);

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
    if (store.preferences.showAppTutorial) {
      setIsGuideOpen(true);
      return;
    }
    if (
      !profilePromptEvaluated.current &&
      !store.preferences.profilePromptSeen &&
      !store.preferences.profileName.trim()
    ) {
      profilePromptEvaluated.current = true;
      store.setActiveModal("profile");
    }
  }, [
    dbReady,
    store.activeModal,
    store.preferences.profileName,
    store.preferences.profilePromptSeen,
    store.preferences.showAppTutorial,
  ]);

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

    setLessonBoardOpenRequest({
      workspaceId: node.workspace_id,
      nodeId: node.id,
      requestId: ++lessonBoardRequestIdRef.current,
    });
    openExcalidrawView();
  };
  const handleLessonBoardRequestHandled = useCallback((requestId: number) => {
    setLessonBoardOpenRequest((current) =>
      current?.requestId === requestId ? null : current
    );
  }, []);

  const activeWorkspace =
  activeWorkspaces.find((workspace) => workspace.id === store.activeWorkspaceId) ??
  null;
  const selectedNode =
    store.nodes.find((node) => node.id === store.selectedNodeId) ?? null;
  if (selectedNode) lastSelectedNodeRef.current = selectedNode;
  const lessonNode = selectedNode ?? lastSelectedNodeRef.current;
  const masteredCount = store.nodes.filter(
    (node) => node.status === "mastered"
  ).length;
  const curriculumWorkspaceProgress = useMemo(() => {
    if (!store.activeWorkspaceId) return store.workspaceProgress;
    return {
      ...store.workspaceProgress,
      [store.activeWorkspaceId]: {
        nodeCount: store.nodes.length,
        masteredCount,
      },
    };
  }, [
    masteredCount,
    store.activeWorkspaceId,
    store.nodes.length,
    store.workspaceProgress,
  ]);

  return (
    <div
      data-theme={store.preferences.theme}
      data-font={store.preferences.fontFamily}
      data-reading-scale={store.preferences.readingScale}
      data-high-contrast-text={store.preferences.highContrastText}
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
              collapsed={isSidebarLockedView || sidebarCollapsed}
              isLockedView={isSidebarLockedView}
              isExcalidrawActive={mainView === "excalidraw"}
              onExcalidrawSidebarSlotChange={setExcalidrawSidebarSlot}
              onNewExcalidrawBoard={() =>
                setExcalidrawCreateBoardRequest((request) => request + 1)
              }
              hasExcalidrawLesson={Boolean(lessonNode)}
              isExcalidrawLessonOpen={isExcalidrawLessonOpen}
              onToggleExcalidrawLesson={() =>
                setIsExcalidrawLessonOpen((open) => !open)
              }
              excalidrawBoardSearchQuery={excalidrawBoardSearchQuery}
              onExcalidrawBoardSearchQueryChange={
                setExcalidrawBoardSearchQuery
              }
              workspaces={activeWorkspaces}
              archivedWorkspaces={store.archivedWorkspaces}
              workspaceProgress={store.workspaceProgress}
              activeWorkspaceId={store.activeWorkspaceId}
              nodes={store.nodes}
              dueCount={globalDueCount}
              flashcardsEnabled={flashcardsEnabled}
              documentCount={store.documents.length}
              onToggle={toggleSidebar}
              onSelect={(id) => {
                setMainView("graph");
                return store.selectWorkspace(id);
              }}
              onArchive={store.archiveWorkspace}
              onRestore={store.restoreWorkspace}
              onPermanentlyDelete={store.permanentlyDeleteWorkspace}
              onGetDeleteSummary={getWorkspaceDeletionSummary}
              onNewWorkspace={() => {
                setMainView("graph");
                store.setActiveModal("new_workspace");
              }}
              isDashboardActive={
                mainView === "dashboard" || mainView === "calendar"
              }
              isCurriculumActive={mainView === "curriculum"}
              curriculumTrees={curriculumTrees}
              archivedCurriculumTrees={archivedCurriculumTrees}
              selectedCurriculumTreeId={selectedCurriculumTreeId}
              onSelectCurriculumTree={setSelectedCurriculumTreeId}
              onRenameCurriculumTree={async (id, title) => {
                const trimmed = title.trim();
                if (!trimmed) return;
                await renameCurriculumTree(id, trimmed);
                const now = Date.now();
                setCurriculumTrees((items) =>
                  items.map((item) =>
                    item.id === id
                      ? { ...item, title: trimmed, updated_at: now }
                      : item
                  )
                );
              }}
              onArchiveCurriculumTree={async (id) => {
                await archiveCurriculumTree(id);
                const target = curriculumTrees.find((item) => item.id === id);
                const remaining = curriculumTrees.filter(
                  (item) => item.id !== id
                );
                setCurriculumTrees(remaining);
                if (target) {
                  setArchivedCurriculumTrees((items) => [
                    { ...target, archived_at: Date.now() },
                    ...items,
                  ]);
                }
                if (selectedCurriculumTreeId === id) {
                  setSelectedCurriculumTreeId(remaining[0]?.id ?? null);
                }
              }}
              onRestoreCurriculumTree={async (id) => {
                await restoreCurriculumTree(id);
                const tree = archivedCurriculumTrees.find(
                  (item) => item.id === id
                );
                if (!tree) return;
                setArchivedCurriculumTrees((items) =>
                  items.filter((item) => item.id !== id)
                );
                setCurriculumTrees((items) =>
                  [{ ...tree, archived_at: null }, ...items].sort(
                    (left, right) => right.updated_at - left.updated_at
                  )
                );
              }}
              onDeleteArchivedCurriculumTree={async (id) => {
                await deleteCurriculumTree(id);
                setArchivedCurriculumTrees((items) =>
                  items.filter((item) => item.id !== id)
                );
              }}
              onNewCurriculumMap={() => {
                setMainView("curriculum");
                setIsCreatingCurriculumTree(true);
              }}
              onVault={() => store.setActiveModal("vault")}
              onReview={() => void openGlobalReviewQueue()}
              onGuide={() => setIsGuideOpen(true)}
              onSettings={() => {
                setSettingsGuideRequest(null);
                store.setActiveModal("settings");
              }}
              onRequestExit={requestExitConfirmation}
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
        <header className="app-topbar z-10 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-6">
            <div className="flex min-w-0 items-center gap-4">
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold tracking-[-0.01em]">
                  {mainView === "dashboard"
                    ? "Study dashboard"
                    : mainView === "calendar"
                      ? "Study Calendar"
                    : mainView === "curriculum"
                      ? "Curriculum maps"
                      : activeWorkspace?.title ?? "Learning studio"}
                </h1>
                {mainView !== "curriculum" &&
                  mainView !== "dashboard" &&
                  mainView !== "calendar" &&
                  activeWorkspace && (() => {
                    const pct =
                      store.nodes.length > 0
                        ? Math.round((masteredCount / store.nodes.length) * 100)
                        : 0;
                    return (
                      <div className="mt-1 flex items-center gap-2.5">
                        <div
                          role="progressbar"
                          aria-label="Workspace mastery progress"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={pct}
                          className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--color-border)] sm:w-36"
                        >
                          <div
                            className="h-full origin-left rounded-full bg-[var(--color-success)] transition-transform duration-150 ease-[var(--ease-spring)]"
                            style={{
                              width: "100%",
                              transform: `scaleX(${pct / 100})`,
                            }}
                          />
                        </div>
                        <span className="shrink-0 font-mono text-[10px] font-medium tabular-nums text-[var(--color-muted)]">
                          {pct}% mastered
                        </span>
                      </div>
                    );
                  })()}
                {mainView === "curriculum" &&
                  !isCreatingCurriculumTree &&
                  selectedCurriculumTreeId && (() => {
                    const pct =
                      curriculumProgress.nodeCount > 0
                        ? Math.round(
                            (curriculumProgress.masteredCount /
                              curriculumProgress.nodeCount) *
                              100
                          )
                        : 0;
                    return (
                      <div className="mt-1 flex items-center gap-2.5">
                        <div
                          role="progressbar"
                          aria-label="Curriculum map mastery progress"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={pct}
                          className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--color-border)] sm:w-36"
                        >
                          <div
                            className="h-full origin-left rounded-full bg-[var(--color-success)] transition-transform duration-150 ease-[var(--ease-spring)]"
                            style={{
                              width: "100%",
                              transform: `scaleX(${pct / 100})`,
                            }}
                          />
                        </div>
                        <span className="shrink-0 font-mono text-[10px] font-medium tabular-nums text-[var(--color-muted)]">
                          {pct}% mastered
                        </span>
                      </div>
                    );
                  })()}
              </div>
              <nav
                aria-label="Workspace views"
                className="flex shrink-0 items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-1 shadow-sm"
              >
                <button
                  type="button"
                  data-guide="dashboard-tab"
                  onClick={() => {
                    setMainView("dashboard");
                  }}
                  aria-pressed={mainView === "dashboard"}
                  aria-label="Dashboard"
                  title="Dashboard"
                  className={`app-topbar-labeled-button flex min-h-9 items-center gap-2 rounded-lg px-3 text-[11px] font-semibold transition ${
                    mainView === "dashboard"
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  <span aria-hidden="true" className="app-topbar-button-label">
                    Dashboard
                  </span>
                </button>
                {studyCalendarEnabled && (
                  <button
                    type="button"
                    data-guide="calendar-tab"
                    onClick={() => {
                      setMainView("calendar");
                      promptForNativeNotifications();
                    }}
                    aria-pressed={mainView === "calendar"}
                    aria-label="Calendar"
                    title="Calendar"
                    className={`app-topbar-labeled-button flex min-h-9 items-center gap-2 rounded-lg px-3 text-[11px] font-semibold transition ${
                      mainView === "calendar"
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
                        : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    }`}
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span aria-hidden="true" className="app-topbar-button-label">
                      Calendar
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  data-guide="workspace-tab"
                  onClick={() => void openTopBarView("graph")}
                  aria-pressed={mainView === "graph"}
                  aria-label="Workspace"
                  title="Workspace"
                  className={`app-topbar-labeled-button flex min-h-9 items-center gap-2 rounded-lg px-3 text-[11px] font-semibold transition ${
                    mainView === "graph"
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  <Network className="h-3.5 w-3.5" />
                  <span aria-hidden="true" className="app-topbar-button-label">
                    Workspace
                  </span>
                </button>
                <button
                  type="button"
                  data-guide="curriculum-tab"
                  onClick={() => void openTopBarView("curriculum")}
                  aria-pressed={mainView === "curriculum"}
                  aria-label="Curriculum"
                  title="Curriculum"
                  className={`app-topbar-labeled-button flex min-h-9 items-center gap-2 rounded-lg px-3 text-[11px] font-semibold transition ${
                    mainView === "curriculum"
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  <span aria-hidden="true" className="app-topbar-button-label">
                    Curriculum
                  </span>
                </button>
                {excalidrawEnabled && (
                  <button
                    type="button"
                    data-guide="excalidraw-tab"
                    onClick={() => void openTopBarView("excalidraw")}
                    aria-pressed={mainView === "excalidraw"}
                    aria-label="Excalidraw"
                    title="Excalidraw"
                    className={`app-topbar-labeled-button flex min-h-9 items-center gap-2 rounded-lg px-3 text-[11px] font-semibold transition ${
                      mainView === "excalidraw"
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm"
                        : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    }`}
                  >
                    <Shapes className="h-3.5 w-3.5" />
                    <span aria-hidden="true" className="app-topbar-button-label">
                      Excalidraw
                    </span>
                  </button>
                )}
              </nav>
            </div>
            <div className="flex items-center gap-2">
              <UpdateIndicator onToast={store.showToast} />
              <button
                type="button"
                onClick={toggleAppearanceMode}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
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
                className={`app-topbar-labeled-button flex h-10 items-center gap-2 rounded-xl border px-3 text-[11px] font-semibold transition ${
                  store.isTutorOpen
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
                }`}
              >
                <Bot className="h-3.5 w-3.5" />
                <span aria-hidden="true" className="app-topbar-button-label">
                  Tutor
                </span>
              </button>
            </div>
        </header>

        <main className="relative flex min-h-0 flex-1 overflow-x-hidden overflow-y-hidden">
          <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              aria-hidden={mainView !== "curriculum"}
              inert={mainView !== "curriculum"}
              data-active={mainView === "curriculum"}
              className="app-page-panel absolute inset-0 flex h-full min-h-0 min-w-0"
            >
              <CurriculumTreeView
                workspaces={activeWorkspaces}
                workspaceProgress={curriculumWorkspaceProgress}
                workspaceDeletionRevision={store.workspaceDeletionRevision}
                onProgressChange={updateCurriculumProgress}
                trees={curriculumTrees}
                onTreesChange={setCurriculumTrees}
                onArchivedTreesChange={setArchivedCurriculumTrees}
                selectedTreeId={selectedCurriculumTreeId}
                onSelectTree={setSelectedCurriculumTreeId}
                isCreatingTree={isCreatingCurriculumTree}
                onSetCreatingTree={setIsCreatingCurriculumTree}
                isNativeFullscreen={isFullscreen}
                showDots={store.preferences.showCanvasDots}
                edgeRouting={store.preferences.edgeRouting}
                nodeDensity={store.preferences.nodeDensity}
                onSelectWorkspace={async (workspaceId) => {
                  await store.selectWorkspace(workspaceId);
                  setMainView("graph");
                }}
                onDeletedWorkspaces={store.reconcileDeletedWorkspaces}
                onCreateWorkspaceForNode={(node) => {
                  pendingCurriculumNodeRef.current = node;
                  setNewWorkspacePrompt(
                    [node.title, node.summary_hint].filter(Boolean).join(": ")
                  );
                  setMainView("graph");
                  store.setActiveModal("new_workspace");
                }}
                onToast={store.showToast}
              />
            </div>
                <div
                  aria-hidden={mainView === "curriculum"}
                  inert={mainView === "curriculum"}
                  data-active={mainView !== "curriculum"}
                  data-excalidraw-canvas={mainView === "excalidraw"}
                  className="app-page-panel absolute inset-0 flex h-full min-h-0 min-w-0"
                >
                  {mainView === "calendar" ? (
                    <StudyCalendarView
                      activeWorkspaces={activeWorkspaces.map((workspace) => {
                        const progress = store.workspaceProgress[workspace.id];
                        return {
                          id: workspace.id,
                          title: workspace.title,
                          unmasteredCount: Math.max(
                            0,
                            (progress?.nodeCount ?? 0) -
                              (progress?.masteredCount ?? 0)
                          ),
                        };
                      })}
                      onToast={store.showToast}
                      onOpenWorkspace={async (workspaceId) => {
                        await store.selectWorkspace(workspaceId);
                        setMainView("graph");
                      }}
                      onStartQuiz={async (workspaceId, nodeId) => {
                        await store.selectWorkspace(workspaceId);
                        await store.selectNode(nodeId);
                        await store.openDiagnosticForNode(nodeId);
                        setMainView("graph");
                      }}
                    />
                  ) : mainView === "dashboard" ? (
                    <div className="min-w-0 flex-1">
                      <DashboardView
                        snapshot={dashboardSnapshot}
                        archivedWorkspaceIds={store.archivedWorkspaces.map(
                          (workspace) => workspace.id
                        )}
                        nextDeadline={nextDeadline}
                        onOpenCalendar={() => setMainView("calendar")}
                        aiUsage={aiUsage}
                        aiUsageEnabled={aiUsageEnabled}
                        isLoading={isDashboardLoading}
                        activeWorkspaceTitle={activeWorkspace?.title ?? null}
                        reviewsCompletedToday={getReviewsCompletedToday()}
                        dailyReviewLimit={store.preferences.dailyReviewLimit}
                        weeklyConsistency={weeklyConsistency}
                        flashcardsEnabled={flashcardsEnabled}
                        excalidrawEnabled={excalidrawEnabled}
                        profileName={store.preferences.profileName}
                        profileFocus={store.preferences.profileFocus}
                        onEditProfile={() => store.setActiveModal("profile")}
                        onOpenWorkspace={async (workspaceId) => {
                          await store.selectWorkspace(workspaceId);
                          setMainView("graph");
                        }}
                        onOpenWorkspaceView={async (workspaceId, view) => {
                          if (store.activeWorkspaceId !== workspaceId) {
                            pendingViewAfterWorkspaceSelectRef.current = view;
                            if (
                              view === "excalidraw" &&
                              !sidebarCollapsedRef.current
                            ) {
                              sidebarCollapsedRef.current = true;
                              setSidebarCollapsed(true);
                            }
                            await store.selectWorkspace(workspaceId);
                          }
                          if (view === "excalidraw") {
                            openExcalidrawView();
                          } else {
                            setMainView(view);
                          }
                        }}
                        onOpenConcept={async (workspaceId, nodeId) => {
                          await store.selectWorkspace(workspaceId);
                          await store.selectNode(nodeId);
                          setMainView("graph");
                        }}
                        onRetakeQuiz={async (workspaceId, nodeId) => {
                          if (store.activeWorkspaceId !== workspaceId) {
                            pendingViewAfterWorkspaceSelectRef.current =
                              "dashboard";
                            await store.selectWorkspace(workspaceId);
                          }
                          await store.selectNode(nodeId);
                          await store.resetDiagnosticAttempt(nodeId);
                          await store.openDiagnosticForNode(nodeId);
                        }}
                        onOpenCurriculumTree={(treeId) => {
                          setSelectedCurriculumTreeId(treeId);
                          setIsCreatingCurriculumTree(false);
                          setMainView("curriculum");
                        }}
                        onNewCurriculumMap={() => {
                          setIsCreatingCurriculumTree(true);
                          setMainView("curriculum");
                        }}
                        onOpenActiveWorkspace={() => setMainView("graph")}
                        onNewWorkspace={() =>
                          store.setActiveModal("new_workspace")
                        }
                        onOpenReview={() => void openGlobalReviewQueue()}
                        onOpenVault={() => store.setActiveModal("vault")}
                      />
                    </div>
                  ) : mainView === "excalidraw" ? (
                    activeWorkspace ? (
                      <div className="view-crossfade flex h-full min-h-0 min-w-0 flex-1">
                        <Suspense
                          fallback={
                            <div className="flex flex-1 items-center justify-center text-xs text-[var(--color-muted)]">
                              Loading Excalidraw…
                            </div>
                          }
                        >
                          <ExcalidrawWorkspace
                            workspaceId={activeWorkspace.id}
                            openBoardRequest={lessonBoardOpenRequest}
                            onBoardRequestHandled={
                              handleLessonBoardRequestHandled
                            }
                            selectedNode={selectedNode}
                            nodes={store.nodes}
                            appearanceMode={store.preferences.appearanceMode}
                            sidebarPortalTarget={excalidrawSidebarTarget}
                            sidebarCollapsed={sidebarCollapsed}
                            createBoardRequest={excalidrawCreateBoardRequest}
                            boardSearchQuery={excalidrawBoardSearchQuery}
                            onSelectNode={(nodeId) => store.selectNode(nodeId)}
                            onToast={store.showToast}
                          />
                        </Suspense>
                      </div>
                    ) : (
                      <div className="view-crossfade flex flex-1 items-center justify-center p-8 text-center">
                        <p className="max-w-sm text-xs leading-5 text-[var(--color-muted)]">
                          Select or create a workspace before opening Excalidraw boards.
                        </p>
                      </div>
                    )
                  ) : !activeWorkspace ? (
                    <div
                      data-guide="canvas"
                      className="view-crossfade flex flex-1 flex-col items-center justify-center p-8 text-center"
                    >
                      {isGuideOpen ? (
                        <GuideDagPreview
                          showDots={store.preferences.showCanvasDots}
                          edgeRouting={store.preferences.edgeRouting}
                          nodeDensity={store.preferences.nodeDensity}
                        />
                      ) : (
                        <>
                          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">
                            Workspace
                          </p>
                          <h2 className="mt-3 text-xl font-semibold tracking-tight">
                            No workspace selected
                          </h2>
                          <div className="mt-5 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => store.setActiveModal("new_workspace")}
                              className="rounded-lg bg-[var(--color-accent-button)] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-95"
                            >
                              Create workspace
                            </button>
                            <button
                              type="button"
                              onClick={() => store.setActiveModal("vault")}
                              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2.5 text-xs font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
                            >
                              Add notes
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div
                      key={activeWorkspace.id}
                      data-guide="canvas"
                      className="view-crossfade min-w-0 flex-1"
                    >
                      {isGuideOpen && store.nodes.length === 0 ? (
                        <GuideDagPreview
                          showDots={store.preferences.showCanvasDots}
                          edgeRouting={store.preferences.edgeRouting}
                          nodeDensity={store.preferences.nodeDensity}
                        />
                      ) : (
                        <DagCanvas
                          workspaceId={activeWorkspace.id}
                          isNativeFullscreen={isFullscreen}
                          nodes={store.nodes}
                          edges={store.edges}
                          layoutMode={activeWorkspace.layout_mode}
                          selectedNodeId={store.selectedNodeId}
                          showDots={store.preferences.showCanvasDots}
                          edgeRouting={store.preferences.edgeRouting}
                          nodeDensity={store.preferences.nodeDensity}
                          onSelectNode={(id) => store.selectNode(id)}
                          quizNodeIds={store.quizNodeIds}
                          canUndo={store.undoStack.length > 0}
                          canRedo={store.redoStack.length > 0}
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
                          onUndo={store.undoGraph}
                          onRedo={store.redoGraph}
                          onToast={store.showToast}
                        />
                      )}
                    </div>
                  )}
                </div>
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
                      : mainView === "excalidraw" && isExcalidrawLessonOpen
                  }
                  companionOpen={store.isTutorOpen && tutorPanelReady}
                  isHydrating={store.hydratingNodeIds.has(lessonNode.id)}
                  hydrationError={
                    store.hydrationErrors.get(lessonNode.id) ?? null
                  }
                  generationPreview={
                    store.lessonGenerationText.get(lessonNode.id) ?? ""
                  }
                  flashcardCount={
                    store.flashcardCounts.get(lessonNode.id) ?? null
                  }
                  flashcardsEnabled={flashcardsEnabled}
                  isGeneratingFlashcards={store.generatingFlashcardNodeIds.has(
                    lessonNode.id
                  )}
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
                  onGenerateFlashcards={() =>
                    void store.generateNodeFlashcards(lessonNode.id)
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
                    mainView === "dashboard"
                      ? null
                      : mainView === "excalidraw"
                        ? lessonNode
                        : selectedNode
                  }
                  activeNodeTitle={
                    mainView === "dashboard"
                      ? undefined
                      : (mainView === "excalidraw" ? lessonNode : selectedNode)
                          ?.title
                  }
                  dashboardContext={dashboardContext}
                  userProfile={{
                    name: store.preferences.profileName,
                    focus: store.preferences.profileFocus,
                  }}
                  studyCalendarEnabled={studyCalendarEnabled}
                  calendarWorkspaces={activeWorkspaces.map((workspace) => {
                    const progress = store.workspaceProgress[workspace.id];
                    return {
                      id: workspace.id,
                      title: workspace.title,
                      unmasteredCount: Math.max(
                        0,
                        (progress?.nodeCount ?? 0) -
                          (progress?.masteredCount ?? 0)
                      ),
                    };
                  })}
                  workspaceId={store.activeWorkspaceId}
                  onPanelReady={() => setTutorPanelReady(true)}
                  onClose={() => store.setTutorOpen(false)}
                  onToast={store.showToast}
                />
              </Suspense>
            )}
          </div>

        </main>
        </div>
        </div>

          {(hasOpenedModal || store.activeModal !== "none") && (
            <Suspense fallback={null}>
              <Modals
            activeModal={store.activeModal}
            activeWorkspaceId={store.activeWorkspaceId}
            selectedNodeId={store.selectedNodeId}
            initialWorkspacePrompt={newWorkspacePrompt}
            selectedNodeTitle={selectedNode?.title ?? ""}
            theme={store.preferences.theme}
            isGeneratingCurriculum={store.isGeneratingCurriculum}
            curriculumProgress={store.curriculumProgress}
            masteryPassThreshold={store.preferences.masteryPassThreshold}
            dueCards={store.dueCards}
            flashcardNodes={store.nodes}
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
            onClose={() => {
              if (store.activeModal === "new_workspace") {
                pendingCurriculumNodeRef.current = null;
                setNewWorkspacePrompt("");
              }
              store.setActiveModal("none");
            }}
            onCreateWorkspace={async (title, rootDomain) => {
              await store.createManualWorkspace(title, rootDomain);
              await linkPendingCurriculumWorkspace();
            }}
            onGenerateCurriculum={async (topic, sourceDocument) => {
              const generated = await store.generateNewCurriculum(
                topic,
                sourceDocument
              );
              if (generated) await linkPendingCurriculumWorkspace();
            }}
            onCancelCurriculum={() => store.cancelCurriculumGeneration()}
            onGradeCard={(card, grade) => store.gradeDueCard(card, grade)}
            onLoadFlashcards={store.loadWorkspaceFlashcards}
            onGenerateFlashcardsForTopic={(nodeId, topic) =>
              store.generateFlashcardsForTopic(nodeId, topic)
            }
            onCreateFlashcard={store.createFlashcard}
            onEditFlashcard={store.editFlashcard}
            onRemoveFlashcard={store.removeFlashcard}
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
            onRequestExit={requestExitConfirmation}
            settingsGuideRequest={settingsGuideRequest}
            settingsCloseRequest={settingsCloseRequest}
              />
            </Suspense>
          )}

          {(hasOpenedGuide || isGuideOpen) && (
            <AppGuide
              isOpen={isGuideOpen}
              currentView={mainView}
              onNavigate={navigateGuideToView}
              onOpenSettingsSection={openSettingsSectionFromGuide}
              onCloseSettings={closeSettingsFromGuide}
              flashcardsEnabled={flashcardsEnabled}
              studyCalendarEnabled={studyCalendarEnabled}
              excalidrawEnabled={excalidrawEnabled}
              onClose={closeGuide}
              showOnStartup={store.preferences.showAppTutorial}
              onShowOnStartupChange={setGuideOnStartup}
            />
          )}
        </>
      ) : null}
      {isExitConfirmationOpen && (
        <ExitConfirmationModal
          onCancel={() => setIsExitConfirmationOpen(false)}
          onConfirm={() => exit(0)}
          onError={(error) =>
            store.showToast(
              error instanceof Error ? error.message : String(error)
            )
          }
        />
      )}
      <BootSplash
        ready={dbReady || Boolean(bootError)}
        status={bootError ? "Local vault unavailable" : undefined}
      />
      <NotificationConsentModal
        isOpen={isNotificationConsentOpen}
        error={notificationConsentError}
        onEnable={enableNativeNotifications}
        onDismiss={() => {
          setNotificationConsentError(null);
          setIsNotificationConsentOpen(false);
        }}
      />
      <AnimatedPresence
        present={Boolean(store.toastMessage)}
        motion="toast"
        className="pointer-events-none fixed bottom-5 right-5 z-[9999]"
        exitDuration={170}
      >
        {store.toastMessage ? (
          <div
            role="status"
            aria-live="polite"
            className="max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2.5 text-xs font-medium text-[var(--color-ink)] shadow-[0_12px_36px_rgba(31,43,51,0.18)]"
          >
            {store.toastMessage}
          </div>
        ) : null}
      </AnimatedPresence>
    </div>
  );
}

function GuideDagPreview({
  showDots,
  edgeRouting,
  nodeDensity,
}: {
  showDots: boolean;
  edgeRouting: UserPreferences["edgeRouting"];
  nodeDensity: UserPreferences["nodeDensity"];
}) {
  return (
    <div
      aria-hidden="true"
      inert
      className="pointer-events-none h-full min-h-[440px] w-full overflow-hidden [&_[data-canvas-toolbar]]:hidden"
    >
      <DagCanvas
        workspaceId={null}
        isNativeFullscreen={false}
        nodes={GUIDE_NODES}
        edges={GUIDE_EDGES}
        layoutMode="auto"
        selectedNodeId={null}
        showDots={showDots}
        edgeRouting={edgeRouting}
        nodeDensity={nodeDensity}
        quizNodeIds={new Set()}
        canUndo={false}
        canRedo={false}
        onSelectNode={() => {}}
        onSetLayoutMode={async () => {}}
        onMoveNode={async () => {}}
        onRealignGrid={async () => {}}
        onAddNode={async () => "guide-preview"}
        onEditNode={async () => {}}
        onArchiveNode={async () => {}}
        onRestoreArchivedNode={async () => {}}
        onPermanentlyDeleteArchivedNode={async () => {}}
        onConnectNodes={async () => {}}
        onDisconnectNodes={async () => {}}
        onUndo={async () => {}}
        onRedo={async () => {}}
        onToast={() => {}}
      />
    </div>
  );
}

export default function App() {
  if (typeof window !== "undefined" && window.location.hash === "#mini-agenda") {
    return <MiniAgendaView />;
  }
  return <MainApp />;
}
