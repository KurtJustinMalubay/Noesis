import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  ChevronUp,
  GitBranch,
  Layers,
  Network,
  RotateCcw,
  Shapes,
  User,
} from "lucide-react";
import type { DashboardSnapshot } from "../db/repositories/dashboardRepo";
import {
  getOpenAiPreset,
  loadAiSettings,
  type WeeklyConsistencyDay,
} from "../ai/keyStore";
import type { AiUsageSummary } from "../ai/usage";
import type { CalendarEvent } from "../calendar/types";
import { differenceInIsoDays, toLocalIsoDate } from "../calendar/dateUtils";

const MIN_UP_NEXT_LIMIT = 3;
const MAX_UP_NEXT_LIMIT = 6;
const MIN_WORKSPACE_LIMIT = 1;
const MAX_WORKSPACE_LIMIT = 6;

const EDITORIAL_ACCENTS = [
  "#4f7a65", // sage green
  "#496f8f", // slate blue
  "#b06348", // warm terracotta
  "#a47c3b", // muted ochre
] as const;

interface DashboardViewProps {
  snapshot: DashboardSnapshot | null;
  archivedWorkspaceIds: readonly string[];
  nextDeadline?: CalendarEvent | null;
  onOpenCalendar?: () => void;
  aiUsage: AiUsageSummary;
  aiUsageEnabled: boolean;
  isLoading: boolean;
  activeWorkspaceTitle: string | null;
  reviewsCompletedToday: number;
  dailyReviewLimit: number;
  weeklyConsistency: WeeklyConsistencyDay[];
  flashcardsEnabled: boolean;
  excalidrawEnabled: boolean;
  profileName?: string;
  profileFocus?: string;
  onEditProfile: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenWorkspaceView: (
    workspaceId: string,
    view: "graph" | "curriculum" | "excalidraw"
  ) => void;
  onOpenConcept: (workspaceId: string, nodeId: string) => void;
  onRetakeQuiz: (workspaceId: string, nodeId: string) => void;
  onOpenCurriculumTree: (treeId: string) => void;
  onNewCurriculumMap: () => void;
  onOpenActiveWorkspace: () => void;
  onNewWorkspace: () => void;
  onOpenReview: () => void;
  onOpenVault: () => void;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatRelativeDay(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return "";
  const diffDays = Math.floor((Date.now() - timestampMs) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  return new Date(timestampMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function hashWorkspaceAccent(workspaceId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < workspaceId.length; i += 1) {
    hash ^= workspaceId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return EDITORIAL_ACCENTS[(hash >>> 0) % EDITORIAL_ACCENTS.length];
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function useFitItemCount(
  containerRef: RefObject<HTMLElement | null>,
  listRef: RefObject<HTMLDivElement | null>,
  itemCount: number,
  minItems: number,
  maxItems: number
): number {
  const [visibleCount, setVisibleCount] = useState(Math.max(minItems, 1));

  useEffect(() => {
    const container = containerRef.current;
    const list = listRef.current;
    if (!container || !list) return;

    const updateCount = () => {
      const style = window.getComputedStyle(container);
      const bottomInset =
        (Number.parseFloat(style.paddingBottom) || 0) +
        (Number.parseFloat(style.borderBottomWidth) || 0);
      const availableHeight =
        container.getBoundingClientRect().bottom -
        bottomInset -
        list.getBoundingClientRect().top;
      const rowHeight = Math.max(
        1,
        ...Array.from(list.children, (row) => row.getBoundingClientRect().height)
      );
      const fittedCount = Math.floor(availableHeight / rowHeight);
      const upperLimit = Math.min(maxItems, itemCount);
      const lowerLimit = Math.min(minItems, upperLimit);
      const nextCount = Math.max(
        lowerLimit,
        Math.min(upperLimit, fittedCount)
      );
      setVisibleCount((current) =>
        current === nextCount ? current : nextCount
      );
    };

    if (typeof ResizeObserver === "undefined") {
      setVisibleCount(Math.min(itemCount, Math.max(minItems, 4)));
      return;
    }

    const observer = new ResizeObserver(() => {
      for (const row of Array.from(list.children)) observer.observe(row);
      updateCount();
    });
    observer.observe(container);
    observer.observe(list);
    for (const row of Array.from(list.children)) observer.observe(row);
    updateCount();
    return () => observer.disconnect();
  }, [containerRef, itemCount, listRef, maxItems, minItems]);

  return visibleCount;
}

const AMBER_PILL_STYLE = {
  backgroundColor: "color-mix(in srgb, var(--color-warning) 14%, var(--color-panel))",
  borderColor: "color-mix(in srgb, var(--color-warning) 28%, transparent)",
  color: "var(--color-warning)",
} as const;

const TACTILE_CARD_CLASSES =
  "motion-safe:transition-colors motion-safe:duration-150 hover:bg-[var(--color-hover)] motion-reduce:transition-none";

export function DashboardView({
  snapshot,
  archivedWorkspaceIds,
  nextDeadline = null,
  onOpenCalendar,
  aiUsage,
  aiUsageEnabled,
  isLoading,
  activeWorkspaceTitle,
  reviewsCompletedToday,
  dailyReviewLimit,
  weeklyConsistency,
  flashcardsEnabled,
  excalidrawEnabled,
  profileName,
  profileFocus,
  onEditProfile,
  onOpenWorkspace,
  onOpenWorkspaceView,
  onOpenConcept,
  onRetakeQuiz,
  onOpenCurriculumTree,
  onNewCurriculumMap,
  onOpenActiveWorkspace,
  onNewWorkspace,
  onOpenReview,
  onOpenVault,
}: DashboardViewProps) {
  const [showAllUpNext, setShowAllUpNext] = useState(false);
  const continueStudyingRef = useRef<HTMLElement | null>(null);
  const upNextListRef = useRef<HTMLDivElement | null>(null);
  const workspacesRef = useRef<HTMLElement | null>(null);
  const workspaceListRef = useRef<HTMLDivElement | null>(null);
  const archivedWorkspaceIdSet = new Set(archivedWorkspaceIds);
  const workspaces = (snapshot?.workspaces ?? []).filter(
    (workspace) => !archivedWorkspaceIdSet.has(workspace.id)
  );
  const upNextConcepts = snapshot?.upNextConcepts ?? [];
  const upNextLimit = useFitItemCount(
    continueStudyingRef,
    upNextListRef,
    upNextConcepts.length,
    MIN_UP_NEXT_LIMIT,
    MAX_UP_NEXT_LIMIT
  );
  const hasMoreUpNext = upNextConcepts.length > upNextLimit;
  const visibleUpNext = showAllUpNext
    ? upNextConcepts
    : upNextConcepts.slice(0, upNextLimit);
  const workspaceLimit = useFitItemCount(
    workspacesRef,
    workspaceListRef,
    workspaces.length,
    MIN_WORKSPACE_LIMIT,
    MAX_WORKSPACE_LIMIT
  );

  const aiSettings = useMemo(() => loadAiSettings(), [aiUsage]);
  const activeProviderLabel =
    aiSettings.provider === "gemini"
      ? "Gemini"
      : getOpenAiPreset(aiSettings.openAiPreset).label;
  const activeModelName =
    aiSettings.provider === "gemini"
      ? aiSettings.synthesisModel || aiSettings.fastModel
      : aiSettings.openAiSynthesisModel || aiSettings.openAiFastModel;

  const totals = snapshot?.totals ?? {
    workspaceCount: 0,
    curriculumCount: 0,
    nodeCount: 0,
    masteredCount: 0,
    inProgressCount: 0,
    unlockedCount: 0,
    lockedCount: 0,
    flashcardCount: 0,
    dueFlashcardCount: 0,
    overdueFlashcardCount: 0,
    dueTodayFlashcardCount: 0,
    quizCount: 0,
    averageQuizScore: null,
  };
  const curriculums = snapshot?.curriculums ?? [];
  const recentQuizzes = snapshot?.recentQuizzes ?? [];

  const workspaceAccentMap = useMemo(() => {
    const map = new Map<string, string>();
    const sorted = [...workspaces].sort((a, b) => a.id.localeCompare(b.id));
    sorted.forEach((ws, index) => {
      map.set(ws.id, EDITORIAL_ACCENTS[index % EDITORIAL_ACCENTS.length]);
    });
    return map;
  }, [workspaces]);

  const getWorkspaceColor = (workspaceId: string) =>
    workspaceAccentMap.get(workspaceId) ?? hashWorkspaceAccent(workspaceId);

  if (isLoading && !snapshot) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-xs text-[var(--color-muted)]">
        Loading study dashboard…
      </div>
    );
  }

  const masteryPercent =
    totals.nodeCount > 0
      ? Math.round((totals.masteredCount / totals.nodeCount) * 100)
      : 0;
  const reviewGoalPercent =
    dailyReviewLimit > 0
      ? Math.min(100, Math.round((reviewsCompletedToday / dailyReviewLimit) * 100))
      : undefined;

  const topConcept = upNextConcepts[0] ?? null;
  const topWorkspace = workspaces[0] ?? null;
  const weakestQuiz =
    recentQuizzes.length > 0
      ? recentQuizzes.reduce((lowest, current) =>
          (current.score ?? current.best_score) <
          (lowest.score ?? lowest.best_score)
            ? current
            : lowest
        )
      : null;
  const weakestQuizPercent = weakestQuiz
    ? Math.round((weakestQuiz.score ?? weakestQuiz.best_score) * 100)
    : null;
  const prioritizeReview = flashcardsEnabled && totals.dueFlashcardCount > 0;
  const completedDaysThisWeek = weeklyConsistency.filter(
    (day) => day.status === "completed"
  ).length;

  return (
    <div className="view-crossfade h-full overflow-y-auto px-6 py-6 select-text">
      <div className="mx-auto max-w-7xl space-y-6">
        <section
          className="dashboard-settle flex flex-col gap-4 border-b border-[var(--color-border)] pb-5 sm:flex-row sm:items-end sm:justify-between"
          style={{ animationDelay: "0ms" }}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                {profileName?.trim()
                  ? `${getGreeting()}, ${profileName.trim()}`
                  : getGreeting()}
              </h2>
              <button
                type="button"
                onClick={onEditProfile}
                title={profileName?.trim() ? "Edit your profile" : "Set up your profile"}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-muted)] motion-safe:transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
              >
                <User className="h-3 w-3" />
                <span className="max-w-[180px] truncate">
                  {profileFocus?.trim() ||
                    (profileName?.trim() ? "Edit profile" : "Set up profile")}
                </span>
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              {totals.workspaceCount > 0 || totals.curriculumCount > 0
                ? `${totals.workspaceCount} active workspace${totals.workspaceCount === 1 ? "" : "s"} · ${totals.curriculumCount} curriculum map${totals.curriculumCount === 1 ? "" : "s"}`
                : "Create a workspace or import study notes into your Document Vault to begin."}
            </p>
            {nextDeadline && onOpenCalendar && (
              <button
                type="button"
                onClick={onOpenCalendar}
                className="mt-2 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1 text-[10px] font-medium text-[var(--color-ink)] motion-safe:transition-colors motion-safe:duration-150 hover:bg-[var(--color-hover)] motion-reduce:transition-none"
              >
                <span className="font-semibold text-[var(--color-accent)]">
                  Next deadline
                </span>
                <span className="max-w-[220px] truncate">{nextDeadline.title}</span>
                <span className="shrink-0 text-[var(--color-muted)]">
                  {(() => {
                    const days = differenceInIsoDays(
                      toLocalIsoDate(new Date()),
                      nextDeadline.dueDate
                    );
                    return days === 0
                      ? "Today"
                      : days === 1
                        ? "Tomorrow"
                        : `in ${days} days`;
                  })()}
                </span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {prioritizeReview && (
              <button
                type="button"
                onClick={onOpenReview}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-accent-button)] px-4 py-2.5 text-xs font-semibold text-white motion-safe:transition-[filter,opacity] motion-safe:duration-150 hover:brightness-95 motion-reduce:transition-none"
              >
                <Layers className="h-3.5 w-3.5" />
                Review flashcards
              </button>
            )}
            {!topConcept && workspaces.length === 0 ? (
              <button
                type="button"
                onClick={onNewWorkspace}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-accent-button)] px-4 py-2.5 text-xs font-semibold text-white motion-safe:transition-[filter,opacity] motion-safe:duration-150 hover:brightness-95 motion-reduce:transition-none"
              >
                Create first workspace
              </button>
            ) : null}
          </div>
        </section>

        <section className="grid overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            staggerMs={30}
            label="Concepts mastered"
            value={`${totals.masteredCount}/${totals.nodeCount}`}
            badgeText={totals.nodeCount > 0 ? `${masteryPercent}%` : undefined}
            hint={
              totals.nodeCount > 0
                ? `${totals.masteredCount} mastered · ${totals.inProgressCount} in progress · ${totals.lockedCount} locked`
                : "Create a workspace to map concepts"
            }
            actionLabel="Open graph"
            progress={totals.nodeCount > 0 ? masteryPercent : undefined}
            progressColor="bg-[var(--color-success)]"
            onClick={() => {
              if (activeWorkspaceTitle) {
                onOpenActiveWorkspace();
              } else if (topWorkspace) {
                onOpenWorkspace(topWorkspace.id);
              } else {
                onNewWorkspace();
              }
            }}
          />

          <StatCard
            staggerMs={60}
            label="Reviews today"
            value={
              dailyReviewLimit > 0
                ? `${reviewsCompletedToday}/${dailyReviewLimit}`
                : `${reviewsCompletedToday}`
            }
            badgeText={
              completedDaysThisWeek > 0
                ? `${completedDaysThisWeek}/7d`
                : undefined
            }
            actionLabel="Start review"
            progress={reviewGoalPercent}
            progressColor="bg-[var(--color-accent)]"
            footer={
              <div className="mt-2 flex items-center justify-between gap-2">
                <div
                  className="flex items-center gap-1.5"
                  aria-label="Weekly review consistency"
                >
                  {weeklyConsistency.map((day) => (
                    <div
                      key={day.dateKey}
                      title={`${day.dateKey}: ${day.count} review${day.count === 1 ? "" : "s"}`}
                      className="flex flex-col items-center gap-0.5"
                    >
                      <span
                        className={`h-2 w-2 rounded-full border ${
                          day.status === "completed"
                            ? "border-[var(--color-success)] bg-[var(--color-success)]"
                            : day.status === "today_pending"
                              ? "border-[var(--color-accent)] bg-transparent"
                              : day.status === "missed"
                                ? "border-[var(--color-border-strong)] bg-[var(--color-panel-subtle)]"
                                : "border-[var(--color-border)] bg-transparent opacity-45"
                        }`}
                      />
                      <span className="font-mono text-[8px] leading-none text-[var(--color-muted)]">
                        {day.label}
                      </span>
                    </div>
                  ))}
                </div>
                <span className="text-[10px] text-[var(--color-muted)]">
                  {dailyReviewLimit > 0 ? "Daily goal" : "Unlimited"}
                </span>
              </div>
            }
            onClick={flashcardsEnabled ? onOpenReview : onOpenActiveWorkspace}
          />

          <StatCard
            staggerMs={90}
            label="Due flashcards"
            value={`${totals.dueFlashcardCount}`}
            hint={
              totals.dueFlashcardCount > 0
                ? `${totals.overdueFlashcardCount} overdue · ${totals.dueTodayFlashcardCount} today · ${totals.flashcardCount} total`
                : totals.flashcardCount > 0
                  ? `All caught up · ${totals.flashcardCount} total cards`
                  : "No flashcards created yet"
            }
            actionLabel={totals.flashcardCount > 0 ? "Review deck" : "Open cards"}
            onClick={flashcardsEnabled ? onOpenReview : onOpenActiveWorkspace}
          />

          <StatCard
            staggerMs={120}
            label="Quiz average"
            value={
              totals.averageQuizScore !== null
                ? `${totals.averageQuizScore}%`
                : "—"
            }
            badgeText={
              totals.quizCount > 0 ? `${totals.quizCount} done` : undefined
            }
            hint={
              weakestQuiz && weakestQuizPercent !== null
                ? `Lowest: ${weakestQuiz.node_title} (${weakestQuizPercent}%)`
                : "No diagnostic quizzes yet"
            }
            actionLabel={weakestQuiz ? "Drill weak topic" : "Practice"}
            onClick={() => {
              if (weakestQuiz) {
                onRetakeQuiz(weakestQuiz.workspace_id, weakestQuiz.node_id);
              } else if (topConcept) {
                onOpenConcept(topConcept.workspace_id, topConcept.id);
              } else if (topWorkspace) {
                onOpenWorkspace(topWorkspace.id);
              } else {
                onNewWorkspace();
              }
            }}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-12 lg:items-stretch">
          {/* Left: Continue Studying (Container-Aware) + Curriculum Maps */}
          <div className="flex flex-col gap-5 lg:col-span-7">
            <section
              ref={continueStudyingRef}
              className="dashboard-settle flex flex-1 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"
              style={{ animationDelay: "90ms" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                    Continue studying
                  </h3>
                  <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                    Top priority concepts across your active workspaces.
                  </p>
                </div>
                {hasMoreUpNext ? (
                  <button
                    type="button"
                    aria-expanded={showAllUpNext}
                    onClick={() => setShowAllUpNext((prev) => !prev)}
                    className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-[var(--color-accent)] motion-safe:transition-colors motion-safe:duration-150 hover:bg-[var(--color-accent-soft)] motion-reduce:transition-none"
                  >
                    {showAllUpNext ? (
                      <>
                        Show less
                        <ChevronUp className="h-3.5 w-3.5" />
                      </>
                    ) : (
                      <>
                        View all {upNextConcepts.length}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                ) : (
                  <span className="rounded-full bg-[var(--color-panel-subtle)] px-2.5 py-1 font-mono text-[10px] font-semibold tabular-nums text-[var(--color-muted)]">
                    {upNextConcepts.length} ready
                  </span>
                )}
              </div>

              {visibleUpNext.length > 0 ? (
                <div
                  ref={upNextListRef}
                  className="mt-3 divide-y divide-[var(--color-border)]"
                >
                  {visibleUpNext.map((item) => {
                    const isInProgress = item.status === "in_progress";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          onOpenConcept(item.workspace_id, item.id)
                        }
                        aria-label={`Study ${item.title}, ${isInProgress ? "in progress" : "ready"} in ${item.workspace_title}`}
                        className={`group flex w-full items-center justify-between gap-3 px-2 py-2.5 text-left ${TACTILE_CARD_CLASSES}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            isInProgress
                              ? "bg-[var(--color-warning)]"
                              : "bg-[var(--color-success)]"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-xs font-semibold text-[var(--color-ink)]">
                              {item.title}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]">
                            {item.workspace_title}
                            {item.summary_hint ? ` · ${item.summary_hint}` : ""}
                            {" · "}
                            {isInProgress ? "In progress" : "Ready"}
                          </p>
                        </div>
                        <ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-muted)] motion-safe:transition-colors motion-safe:duration-150 group-hover:text-[var(--color-accent)] motion-reduce:transition-none" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-6 text-center">
                  <BookOpen className="mx-auto h-6 w-6 text-[var(--color-muted)]" />
                  <p className="mt-2 text-xs font-semibold text-[var(--color-ink)]">
                    {totals.nodeCount > 0
                      ? "All available concepts are mastered!"
                      : "No concepts to study yet"}
                  </p>
                  <p className="mt-1 max-w-sm text-[11px] text-[var(--color-muted)]">
                    {totals.nodeCount > 0
                      ? "Start a flashcard session or open your Document Vault to keep momentum."
                      : "Generate your first knowledge graph to start studying."}
                  </p>
                  <button
                    type="button"
                    onClick={
                      totals.nodeCount > 0 && flashcardsEnabled
                        ? onOpenReview
                        : totals.nodeCount > 0
                          ? onOpenVault
                          : onNewWorkspace
                    }
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent-button)] px-3.5 py-2 text-xs font-semibold text-white motion-safe:transition-[filter,transform] motion-safe:duration-150 hover:brightness-95 active:translate-y-[0.5px] motion-reduce:transition-none motion-reduce:transform-none"
                  >
                    {totals.nodeCount > 0 && flashcardsEnabled
                      ? "Review flashcards"
                      : totals.nodeCount > 0
                        ? "Open Document Vault"
                        : "Create workspace"}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </section>

            {/* Curriculum Maps */}
            <section
              className="dashboard-settle rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"
              style={{ animationDelay: "120ms" }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-[var(--color-accent)]" />
                  <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                    Curriculum maps
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onNewCurriculumMap}
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--color-accent)] motion-safe:transition-colors motion-safe:duration-150 hover:bg-[var(--color-accent-soft)] motion-reduce:transition-none"
                >
                  + New map
                </button>
              </div>
              {curriculums.length > 0 ? (
                <div className="mt-2 divide-y divide-[var(--color-border)]">
                  {curriculums.slice(0, 4).map((tree) => {
                    const pct =
                      tree.nodeCount > 0
                        ? Math.round((tree.masteredCount / tree.nodeCount) * 100)
                        : 0;
                    const needsLinking = tree.linked_count === 0;
                    return (
                      <button
                        key={tree.id}
                        type="button"
                        onClick={() => onOpenCurriculumTree(tree.id)}
                        className={`group flex w-full items-center justify-between gap-3 px-1 py-3 text-left ${TACTILE_CARD_CLASSES}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <span className="truncate text-xs font-semibold text-[var(--color-ink)]">
                              {tree.title}
                            </span>
                            <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
                              {tree.linked_count}/{tree.subject_count} linked
                            </span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-2.5">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
                              <div
                                className="h-full rounded-full bg-[var(--color-success)] motion-safe:transition-[width] motion-safe:duration-[400ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
                              {formatRelativeDay(tree.updated_at)}
                            </span>
                          </div>
                        </div>
                        <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-[var(--color-muted)] group-hover:text-[var(--color-accent)]">
                          {needsLinking ? "Link subjects" : "Open"}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3.5 flex items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-4 py-3.5">
                  <p className="text-xs text-[var(--color-muted)]">
                    Connect subjects into a multi-workspace curriculum roadmap.
                  </p>
                  <button
                    type="button"
                    onClick={onNewCurriculumMap}
                    className="group flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-accent)] motion-safe:transition-[border-color,background-color] motion-safe:duration-150 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] motion-reduce:transition-none"
                  >
                    Create map
                    <ArrowRight className="h-3.5 w-3.5 motion-safe:transition-transform motion-safe:duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:transform-none" />
                  </button>
                </div>
              )}
            </section>
          </div>

          {/* Right: Workspaces & Recent Quizzes */}
          <div className="flex flex-col gap-5 lg:col-span-5">
            <section
              ref={workspacesRef}
              className="dashboard-settle flex flex-1 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"
              style={{ animationDelay: "90ms" }}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                  Workspaces
                </h3>
              </div>
              {workspaces.length > 0 ? (
                <div
                  ref={workspaceListRef}
                  className="mt-2 divide-y divide-[var(--color-border)]"
                >
                  {workspaces.slice(0, workspaceLimit).map((ws) => {
                    const pct =
                      ws.nodeCount > 0
                        ? Math.round((ws.masteredCount / ws.nodeCount) * 100)
                        : 0;
                    const wsColor = getWorkspaceColor(ws.id);
                    return (
                      <div
                        key={ws.id}
                        className={`group py-3 ${TACTILE_CARD_CLASSES}`}
                      >
                        <button
                          type="button"
                          onClick={() => onOpenWorkspace(ws.id)}
                          className="w-full text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: wsColor }}
                              />
                              <span className="truncate text-xs font-semibold text-[var(--color-ink)]">
                                {ws.title}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {ws.dueFlashcardCount > 0 && (
                                <span
                                  style={AMBER_PILL_STYLE}
                                  className="rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-semibold tabular-nums"
                                >
                                  {ws.dueFlashcardCount} card
                                  {ws.dueFlashcardCount === 1 ? "" : "s"} due
                                </span>
                              )}
                              <span className="font-mono text-[10px] tabular-nums text-[var(--color-muted)]">
                                {ws.masteredCount}/{ws.nodeCount}
                              </span>
                            </div>
                          </div>
                          <div className="mt-1.5 flex items-center gap-2.5">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-border)]">
                              <div
                                className="h-full rounded-full bg-[var(--color-success)] motion-safe:transition-[width] motion-safe:duration-[400ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
                              {formatRelativeDay(ws.updated_at)}
                            </span>
                          </div>
                        </button>
                        <div className="mt-1 flex flex-wrap items-center gap-3 opacity-100 motion-safe:transition-opacity motion-safe:duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 motion-reduce:transition-none">
                          <button
                            type="button"
                            onClick={() => onOpenWorkspaceView(ws.id, "graph")}
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-muted)] motion-safe:transition-colors motion-safe:duration-150 hover:text-[var(--color-accent)] motion-reduce:transition-none"
                          >
                            <Network className="h-3 w-3" />
                            Graph
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onOpenWorkspaceView(ws.id, "curriculum")
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-muted)] motion-safe:transition-colors motion-safe:duration-150 hover:text-[var(--color-accent)] motion-reduce:transition-none"
                          >
                            <GitBranch className="h-3 w-3" />
                            Curriculum
                          </button>
                          {excalidrawEnabled && (
                            <button
                              type="button"
                              onClick={() =>
                                onOpenWorkspaceView(ws.id, "excalidraw")
                              }
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--color-muted)] motion-safe:transition-colors motion-safe:duration-150 hover:text-[var(--color-accent)] motion-reduce:transition-none"
                            >
                              <Shapes className="h-3 w-3" />
                              Excalidraw
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3.5 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-5 text-center">
                  <p className="text-xs font-semibold text-[var(--color-ink)]">
                    No active workspaces yet
                  </p>
                  <p className="mt-1 text-[11px] text-[var(--color-muted)]">
                    Start a topic workspace to organize lessons and reviews.
                  </p>
                  <button
                    type="button"
                    onClick={onNewWorkspace}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent-button)] px-3 py-1.5 text-[11px] font-semibold text-white motion-safe:transition-[filter,transform] motion-safe:duration-150 hover:brightness-95 active:translate-y-[0.5px] motion-reduce:transition-none motion-reduce:transform-none"
                  >
                    Create workspace
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              )}
            </section>

            <section
              className="dashboard-settle rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"
              style={{ animationDelay: "120ms" }}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                  Recent quizzes
                </h3>
                <span className="font-mono text-[10px] tabular-nums text-[var(--color-muted)]">
                  {totals.quizCount} completed
                </span>
              </div>
              {recentQuizzes.length > 0 ? (
                <div className="mt-2 divide-y divide-[var(--color-border)]">
                  {recentQuizzes.slice(0, 4).map((quiz) => {
                    const pct = Math.round(
                      (quiz.score ?? quiz.best_score) * 100
                    );
                    const isStrong = pct >= 75;
                    const wsColor = getWorkspaceColor(quiz.workspace_id);
                    return (
                      <div
                        key={quiz.node_id}
                        className={`group flex w-full items-center justify-between gap-2.5 px-1 py-2.5 ${TACTILE_CARD_CLASSES}`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            onOpenConcept(quiz.workspace_id, quiz.node_id)
                          }
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-xs font-semibold text-[var(--color-ink)]">
                            {quiz.node_title}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-[var(--color-muted)]">
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: wsColor }}
                            />
                            <span className="truncate">
                              {quiz.workspace_title} · {quiz.attempt_count}{" "}
                              attempt{quiz.attempt_count === 1 ? "" : "s"} ·{" "}
                              {formatRelativeDay(quiz.updated_at)}
                            </span>
                          </p>
                        </button>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span
                            className={`font-mono text-[11px] font-semibold tabular-nums ${
                              isStrong
                                ? "text-[var(--color-success)]"
                                : "text-[var(--color-warning)]"
                            }`}
                          >
                            {pct}%
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onRetakeQuiz(quiz.workspace_id, quiz.node_id)
                            }
                            className={`group/retake inline-flex items-center gap-1 px-1 py-1 text-[10px] font-semibold motion-safe:transition-colors motion-safe:duration-150 motion-reduce:transition-none ${
                              isStrong
                                ? "text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                                : "text-[var(--color-warning)] hover:text-[var(--color-ink)]"
                            }`}
                            title={`Retake ${quiz.node_title} quiz`}
                          >
                            <RotateCcw className="h-2.5 w-2.5" />
                            Retake
                            <ArrowRight className="h-2.5 w-2.5 motion-safe:transition-transform motion-safe:duration-150 group-hover/retake:translate-x-0.5 motion-reduce:transition-none motion-reduce:transform-none" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3.5 flex items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-4 py-3">
                  <p className="text-xs text-[var(--color-muted)]">
                    Complete a concept diagnostic quiz to track mastery here.
                  </p>
                  {topConcept && (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenConcept(topConcept.workspace_id, topConcept.id)
                      }
                      className="group flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-accent)] motion-safe:transition-colors motion-safe:duration-150 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] motion-reduce:transition-none"
                    >
                      Study
                      <ArrowRight className="h-3.5 w-3.5 motion-safe:transition-transform motion-safe:duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:transform-none" />
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
        {aiUsageEnabled && (
          <section
            aria-labelledby="dashboard-ai-usage-title"
            className="dashboard-settle rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5"
            style={{ animationDelay: "150ms" }}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)]">
                  <Activity className="h-4 w-4 text-[var(--color-accent)]" />
                </span>
                <div>
                  <h3
                    id="dashboard-ai-usage-title"
                    className="text-sm font-semibold text-[var(--color-ink)]"
                  >
                    AI usage
                  </h3>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--color-muted)]">
                    Active: {activeProviderLabel}
                    {activeModelName ? ` · ${activeModelName}` : ""}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-5 sm:gap-7">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--color-muted)]">
                    This month
                  </p>
                  <p className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-2xl font-semibold tracking-tight tabular-nums text-[var(--color-ink)]">
                      {aiUsage.thisMonth.requestCount}
                    </span>
                    <span className="text-[11px] text-[var(--color-muted)]">
                      requests
                    </span>
                  </p>
                </div>
                <div className="border-l border-[var(--color-border)] pl-5 sm:pl-7">
                  <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--color-muted)]">
                    Tokens used
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--color-ink)]">
                    {formatTokenCount(
                      aiUsage.thisMonth.inputTokens +
                        aiUsage.thisMonth.outputTokens
                    )}
                  </p>
                  <p className="text-[10px] text-[var(--color-muted)]">
                    {formatTokenCount(aiUsage.thisMonth.inputTokens)} in ·{" "}
                    {formatTokenCount(aiUsage.thisMonth.outputTokens)} out
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 border-t border-[var(--color-border)] pt-3 sm:grid-cols-3">
              {(
                [
                  { key: "lessons", label: "Lessons" },
                  { key: "quizzes", label: "Quizzes" },
                  { key: "tutor", label: "Tutor" },
                ] as const
              ).map(({ key, label }) => {
                const featureStats = aiUsage.thisMonth.byFeature?.[key];
                const reqs = featureStats?.requestCount ?? 0;
                const tokens =
                  (featureStats?.inputTokens ?? 0) +
                  (featureStats?.outputTokens ?? 0);
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-lg bg-[var(--color-panel-subtle)] px-3 py-2.5"
                  >
                    <span className="text-[11px] font-medium text-[var(--color-muted)]">
                      {label}
                    </span>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums text-[var(--color-ink)]">
                        {reqs} <span className="font-normal">req</span>
                      </p>
                      <p className="text-[10px] tabular-nums text-[var(--color-muted)]">
                        {formatTokenCount(tokens)} tokens
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {aiUsage.thisMonth.requestCount === 0 && (
              <p className="mt-2 text-[10px] text-[var(--color-muted)]">
                Usage is saved locally on this device across cloud and local models.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function StatCard({
  staggerMs,
  label,
  value,
  badgeText,
  hint,
  actionLabel,
  progress,
  progressColor,
  footer,
  onClick,
}: {
  staggerMs: number;
  label: string;
  value: string;
  badgeText?: string;
  hint?: string;
  actionLabel: string;
  progress?: number;
  progressColor?: string;
  footer?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value}. ${actionLabel}`}
      title={actionLabel}
      style={{ animationDelay: `${staggerMs}ms` }}
      className={`dashboard-settle group flex min-h-24 flex-col justify-between border-b border-[var(--color-border)] p-4 text-left last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0 ${TACTILE_CARD_CLASSES}`}
    >
      <div>
        <span className="text-[11px] font-medium text-[var(--color-muted)]">
          {label}
        </span>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <p className="text-xl font-semibold tracking-tight tabular-nums text-[var(--color-ink)]">
              {value}
            </p>
            {badgeText && (
              <span className="font-mono text-[10px] font-semibold tabular-nums text-[var(--color-muted)]">
                {badgeText}
              </span>
            )}
          </div>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)] opacity-0 motion-safe:transition-opacity motion-safe:duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" />
        </div>
      </div>
      <div>
        {progress !== undefined && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
            <div
              className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-[400ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${progressColor ?? "bg-[var(--color-accent)]"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {footer}
        {hint && (
          <p className="mt-1.5 truncate text-[10px] text-[var(--color-muted)]">
            {hint}
          </p>
        )}
      </div>
    </button>
  );
}
