import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Link2,
  LoaderCircle,
  Pencil,
  Pin,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  addIsoDays,
  differenceInIsoDays,
  getMonthGridDays,
  parseLocalIsoDate,
  toLocalIsoDate,
} from "../calendar/dateUtils";
import {
  CALENDAR_EVENT_TYPES,
  type CalendarEvent,
  type CalendarEventInput,
  type CalendarEventType,
  type CalendarQuizOption,
} from "../calendar/types";
import {
  bulkCreateCalendarEvents,
  deleteCalendarEvent,
  getCalendarEvents,
  getCalendarQuizOptions,
  toggleCalendarEvent,
  upsertCalendarEvent,
} from "../db/repositories/calendarRepo";

export interface StudyCalendarWorkspace {
  id: string;
  title: string;
  unmasteredCount: number;
}

export interface StudyCalendarViewProps {
  activeWorkspaces: StudyCalendarWorkspace[];
  onToast: (message: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onStartQuiz: (workspaceId: string, quizIdOrNodeId: string) => void;
}

const EVENT_LABELS: Record<CalendarEventType, string> = {
  exam: "Exam",
  deadline: "Deadline",
  quiz_due: "Quiz due",
  study_session: "Study session",
  todo: "To-do",
};

const EVENT_DOT_COLORS: Record<CalendarEventType, string> = {
  exam: "var(--color-accent)",
  deadline: "var(--color-warning)",
  quiz_due: "var(--color-muted)",
  study_session: "var(--color-success)",
  todo: "var(--color-border-strong)",
};

const WORKSPACE_FALLBACK_COLORS = [
  "var(--color-accent)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-muted)",
];

function eventToneStyle(type: CalendarEventType): CSSProperties {
  const color = EVENT_DOT_COLORS[type];
  return {
    color,
    borderColor: `color-mix(in srgb, ${color} 24%, var(--color-border))`,
    backgroundColor: `color-mix(in srgb, ${color} 10%, var(--color-panel))`,
  };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatMonth(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatLongDate(isoDate: string): string {
  return parseLocalIsoDate(isoDate).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: string | null): string {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function examCountdown(dueDate: string, today: string): string {
  const remaining = differenceInIsoDays(today, dueDate);
  if (remaining === 0) return "Today";
  if (remaining === 1) return "Tomorrow";
  if (remaining > 1) return `${remaining} days`;
  if (remaining === -1) return "1 day ago";
  return `${Math.abs(remaining)} days ago`;
}

function dateInputValue(value: string): string {
  return value || toLocalIsoDate(new Date());
}

function eventSort(a: CalendarEvent, b: CalendarEvent): number {
  const timeOrder = (a.dueTime ?? "99:99").localeCompare(b.dueTime ?? "99:99");
  return timeOrder || a.title.localeCompare(b.title);
}

export default function StudyCalendarView({
  activeWorkspaces,
  onToast,
  onOpenWorkspace,
  onStartQuiz,
}: StudyCalendarViewProps) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [selectedDate, setSelectedDate] = useState(() =>
    toLocalIsoDate(new Date())
  );
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [quizOptions, setQuizOptions] = useState<CalendarQuizOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pacingExamId, setPacingExamId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formType, setFormType] = useState<CalendarEventType>("study_session");
  const [formDate, setFormDate] = useState(() => toLocalIsoDate(new Date()));
  const [formTime, setFormTime] = useState("");
  const [formWorkspaceId, setFormWorkspaceId] = useState("");
  const [formQuizId, setFormQuizId] = useState("");
  const [formError, setFormError] = useState("");
  const [workspaceFilterId, setWorkspaceFilterId] = useState<string | null>(null);
  const [quickPopover, setQuickPopover] = useState<
    "type" | "time" | "workspace" | "quiz" | null
  >(null);
  const calendarGridRef = useRef<HTMLDivElement>(null);

  const gridDays = useMemo(() => getMonthGridDays(month), [month]);
  const gridStart = toLocalIsoDate(gridDays[0]);
  const gridEnd = toLocalIsoDate(gridDays[gridDays.length - 1]);
  const today = toLocalIsoDate(new Date());

  const reloadEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextEvents = await getCalendarEvents(gridStart, gridEnd);
      setEvents(nextEvents);
    } catch (error) {
      onToast(`Could not load calendar events: ${String(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [gridEnd, gridStart, onToast]);

  useEffect(() => {
    void reloadEvents();
  }, [reloadEvents]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    void listen("calendar:updated", () => {
      if (active) void reloadEvents();
    })
      .then((stopListening) => {
        if (active) unlisten = stopListening;
        else stopListening();
      })
      .catch((error: unknown) => {
        if (active) {
          onToast(`Could not subscribe to calendar updates: ${String(error)}`);
        }
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [onToast, reloadEvents]);

  useEffect(() => {
    let active = true;
    void getCalendarQuizOptions()
      .then((options) => {
        if (active) setQuizOptions(options);
      })
      .catch((error: unknown) => {
        if (active) onToast(`Could not load quiz links: ${String(error)}`);
      });
    return () => {
      active = false;
    };
  }, [onToast]);

  const activeWorkspaceIds = useMemo(
    () => new Set(activeWorkspaces.map((workspace) => workspace.id)),
    [activeWorkspaces]
  );
  useEffect(() => {
    if (workspaceFilterId && !activeWorkspaceIds.has(workspaceFilterId)) {
      setWorkspaceFilterId(null);
    }
  }, [activeWorkspaceIds, workspaceFilterId]);
  const visibleEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          (!event.workspaceId || activeWorkspaceIds.has(event.workspaceId)) &&
          (!workspaceFilterId || event.workspaceId === workspaceFilterId)
      ),
    [activeWorkspaceIds, events, workspaceFilterId]
  );
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of visibleEvents) {
      const dayEvents = grouped.get(event.dueDate) ?? [];
      dayEvents.push(event);
      grouped.set(event.dueDate, dayEvents);
    }
    grouped.forEach((dayEvents) => dayEvents.sort(eventSort));
    return grouped;
  }, [visibleEvents]);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const workspaceColors = useMemo(() => {
    const colors = new Map<string, string>();
    for (const event of events) {
      if (event.workspaceId && event.workspaceColor) {
        colors.set(event.workspaceId, event.workspaceColor);
      }
    }
    [...activeWorkspaces]
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((workspace, index) => {
        if (!colors.has(workspace.id)) {
          colors.set(
            workspace.id,
            WORKSPACE_FALLBACK_COLORS[index % WORKSPACE_FALLBACK_COLORS.length]
          );
        }
      });
    return colors;
  }, [activeWorkspaces, events]);

  const upcomingExams = visibleEvents
    .filter(
      (event) =>
        event.eventType === "exam" &&
        !event.isCompleted &&
        event.dueDate >= today
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const moveMonth = (amount: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const selectDate = (date: Date) => {
    const value = toLocalIsoDate(date);
    setSelectedDate(value);
    setFormDate(value);
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  const jumpToToday = () => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    selectDate(now);
  };

  const startAdd = (targetDate = selectedDate, workspaceId = "") => {
    setFormTitle("");
    setFormNotes("");
    setFormType("study_session");
    setFormDate(targetDate);
    setFormTime("");
    setFormWorkspaceId(workspaceId);
    setFormQuizId("");
    setFormError("");
    setQuickPopover(null);
    setSelectedDate(targetDate);
    const parsed = parseLocalIsoDate(targetDate);
    setMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    setIsAdding(true);
  };

  const handleCalendarGridKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>
  ) => {
    const target = event.target as HTMLElement;
    const currentDate = target
      .closest<HTMLButtonElement>("[data-calendar-date]")
      ?.dataset.calendarDate;
    if (!currentDate) return;

    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      jumpToToday();
      window.requestAnimationFrame(() => {
        calendarGridRef.current
          ?.querySelector<HTMLButtonElement>(`[data-calendar-date="${today}"]`)
          ?.focus();
      });
      return;
    }

    const dayOffsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const offset = dayOffsets[event.key];
    if (!offset) return;

    event.preventDefault();
    const nextDate = addIsoDays(currentDate, offset);
    selectDate(parseLocalIsoDate(nextDate));
    window.requestAnimationFrame(() => {
      calendarGridRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-calendar-date="${nextDate}"]`
        )
        ?.focus();
    });
  };

  const handleWorkspaceChange = (workspaceId: string) => {
    setFormWorkspaceId(workspaceId);
    if (formQuizId) {
      const selectedQuiz = quizOptions.find((option) => option.id === formQuizId);
      if (selectedQuiz?.workspaceId !== workspaceId) setFormQuizId("");
    }
  };

  const saveNewEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = formTitle.trim();
    if (!title) {
      setFormError("Add a short title to save this event.");
      return;
    }
    setIsSaving(true);
    setFormError("");
    const linkedQuiz = quizOptions.find((option) => option.id === formQuizId);
    const input: CalendarEventInput = {
      title,
      notes: formNotes.trim() || null,
      eventType: formType,
      dueDate: dateInputValue(formDate),
      dueTime: formTime || null,
      workspaceId: linkedQuiz?.workspaceId || formWorkspaceId || null,
      quizId: formQuizId || null,
    };
    try {
      await upsertCalendarEvent(input);
      setIsAdding(false);
      setFormTitle("");
      setFormNotes("");
      setFormType("study_session");
      setFormTime("");
      setFormWorkspaceId("");
      setFormQuizId("");
      setQuickPopover(null);
      setSelectedDate(input.dueDate);
      const parsed = parseLocalIsoDate(input.dueDate);
      setMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
      await reloadEvents();
      onToast("Calendar event added.");
    } catch (error) {
      onToast(`Could not save calendar event: ${String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEvent = async (event: CalendarEvent) => {
    try {
      await toggleCalendarEvent(event.id);
      await reloadEvents();
    } catch (error) {
      onToast(`Could not update calendar event: ${String(error)}`);
    }
  };

  const removeEvent = async (event: CalendarEvent) => {
    try {
      await deleteCalendarEvent(event.id);
      await reloadEvents();
      onToast("Calendar event removed.");
    } catch (error) {
      onToast(`Could not remove calendar event: ${String(error)}`);
    }
  };

  const beginEdit = (event: CalendarEvent) => {
    setEditingEventId(event.id);
    setDraftTitle(event.title);
    setDraftDate(event.dueDate);
  };

  const saveEdit = async (event: CalendarEvent) => {
    const title = draftTitle.trim();
    if (!title) {
      onToast("An event needs a title.");
      return;
    }
    const input: CalendarEventInput = {
      id: event.id,
      title,
      notes: event.notes,
      eventType: event.eventType,
      dueDate: dateInputValue(draftDate),
      dueTime: event.dueTime,
      workspaceId: event.workspaceId,
      quizId: event.quizId,
      isCompleted: event.isCompleted,
      source: event.source,
    };
    try {
      await upsertCalendarEvent(input);
      setEditingEventId(null);
      setSelectedDate(input.dueDate);
      const parsed = parseLocalIsoDate(input.dueDate);
      setMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
      await reloadEvents();
      onToast("Calendar event updated.");
    } catch (error) {
      onToast(`Could not update calendar event: ${String(error)}`);
    }
  };

  const pinMiniAgenda = async () => {
    try {
      await invoke("toggle_mini_agenda_window");
    } catch (error) {
      onToast(`Could not open the mini agenda: ${String(error)}`);
    }
  };

  const createExamPacingPlan = async (
    exam: CalendarEvent,
    workspace: StudyCalendarWorkspace
  ) => {
    const daysRemaining = differenceInIsoDays(today, exam.dueDate);
    if (daysRemaining <= 0) {
      onToast("There are no days before this exam to schedule study sessions.");
      return;
    }

    const conceptsPerDay = Math.ceil(
      workspace.unmasteredCount / daysRemaining
    );
    if (conceptsPerDay <= 0) {
      onToast(`${workspace.title} has no unmastered concepts to pace.`);
      return;
    }

    const sessions: CalendarEventInput[] = Array.from(
      { length: daysRemaining },
      (_, index) => {
        const dueDate = addIsoDays(today, index);
        return {
          title: `Study ${conceptsPerDay} concepts · ${workspace.title}`,
          notes: `Daily target: ${conceptsPerDay} unmastered ${
            conceptsPerDay === 1 ? "concept" : "concepts"
          } in ${workspace.title} as you prepare for "${exam.title}".`,
          eventType: "study_session",
          dueDate,
          dueTime: null,
          workspaceId: workspace.id,
        };
      }
    );

    setPacingExamId(exam.id);
    try {
      await bulkCreateCalendarEvents(sessions);
      await reloadEvents();
      onToast(
        `Created ${sessions.length} daily study ${
          sessions.length === 1 ? "session" : "sessions"
        } for ${exam.title} (${conceptsPerDay} concepts per day).`
      );
    } catch (error) {
      onToast(`Could not create the exam study plan: ${String(error)}`);
    } finally {
      setPacingExamId(null);
    }
  };

  const chooseQuiz = (quizId: string) => {
    setFormQuizId(quizId);
    const selectedQuiz = quizOptions.find((option) => option.id === quizId);
    if (selectedQuiz) setFormWorkspaceId(selectedQuiz.workspaceId);
  };

  return (
    <main className="h-full min-h-0 flex-1 overflow-y-auto bg-[var(--color-canvas)] px-4 py-4 text-[var(--color-ink)] sm:px-7 lg:px-9">
      <div className="mx-auto flex min-h-full max-w-[1500px] flex-col">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-muted)]">
              Plan your learning
            </p>
            <h1 className="font-serif text-3xl font-semibold tracking-[-0.035em] text-[var(--color-ink)] sm:text-[2rem]">
              Study calendar
            </h1>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              A little structure makes room for deeper work.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void pinMiniAgenda()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 text-xs font-medium text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
              title="Pin or unpin the mini agenda"
            >
              <Pin size={15} strokeWidth={1.8} />
              <span className="hidden sm:inline">Pin mini agenda</span>
            </button>
            <button
              type="button"
              onClick={() => startAdd()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--color-accent-button)] px-3.5 text-xs font-semibold text-[var(--color-accent-foreground)] transition-colors duration-150 hover:brightness-95"
            >
              <Plus size={16} />
              Add event
            </button>
          </div>
        </header>

        <div className="grid flex-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(310px,1fr)]">
          <section className="flex h-full min-w-0 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3.5 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-xl font-semibold text-[var(--color-ink)]">
                {formatMonth(month)}
              </h2>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1">
                  {CALENDAR_EVENT_TYPES.map((type) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1 text-[9px] font-medium text-[var(--color-muted)]"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: EVENT_DOT_COLORS[type] }}
                      />
                      {EVENT_LABELS[type]}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={jumpToToday}
                  className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-2.5 text-[10px] font-semibold text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => moveMonth(-1)}
                  aria-label="Previous month"
                  className="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => moveMonth(1)}
                  aria-label="Next month"
                  className="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
                >
                  <ChevronRight size={16} />
                </button>
                {isLoading && (
                  <LoaderCircle
                    size={14}
                    className="animate-spin text-[var(--color-success)]"
                    aria-label="Loading calendar events"
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-7 border-b border-[var(--color-border)] pb-2">
              {WEEKDAYS.map((day) => (
                <div
                  key={day}
                  className="text-center text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)] sm:text-[10px]"
                >
                  {day}
                </div>
              ))}
            </div>
            <div
              ref={calendarGridRef}
              role="group"
              aria-label={formatMonth(month)}
              onKeyDown={handleCalendarGridKeyDown}
              className="grid flex-1 grid-cols-7 grid-rows-6"
            >
              {gridDays.map((date) => {
                const isoDate = toLocalIsoDate(date);
                const dateEvents = eventsByDate.get(isoDate) ?? [];
                const examEvent = dateEvents.find(
                  (event) => event.eventType === "exam" && !event.isCompleted
                );
                const inMonth = date.getMonth() === month.getMonth();
                const isSelected = isoDate === selectedDate;
                const isToday = isoDate === today;
                return (
                  <button
                    key={isoDate}
                    type="button"
                    data-calendar-date={isoDate}
                    onClick={() => selectDate(date)}
                    onDoubleClick={() => startAdd(isoDate)}
                    aria-label={`${formatLongDate(isoDate)}${dateEvents.length ? `, ${dateEvents.length} events` : ""}`}
                    aria-pressed={isSelected}
                    className={`group relative flex min-h-[96px] min-w-0 flex-col items-center border-b border-r border-[var(--color-border)] px-1 pb-1.5 pt-1.5 text-left transition-colors duration-150 sm:items-start sm:px-1.5 ${
                      isSelected
                        ? "bg-[var(--color-selected)]"
                        : "hover:bg-[var(--color-hover)]"
                    } ${!inMonth ? "text-[var(--color-muted)] opacity-65" : "text-[var(--color-ink)]"}`}
                  >
                    <span
                      className={`grid h-7 min-w-7 place-items-center rounded-full px-1 text-[11px] font-semibold ${
                        isToday
                          ? "border border-[var(--color-success)] bg-[var(--color-success)] text-[var(--color-accent-foreground)]"
                          : isSelected
                            ? "border border-[var(--color-border-strong)] text-[var(--color-ink)]"
                            : ""
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    <span className="mt-1 flex w-full flex-col gap-0.5">
                      {dateEvents.slice(0, 3).map((event) => (
                        <span
                          key={event.id}
                          title={event.title}
                          className="flex min-w-0 items-center gap-1 rounded border px-1 py-[1px]"
                          style={eventToneStyle(event.eventType)}
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: EVENT_DOT_COLORS[event.eventType] }}
                          />
                          <span className="hidden min-w-0 truncate text-[8px] leading-3 lg:block">
                            {event.title}
                          </span>
                        </span>
                      ))}
                      {dateEvents.length > 3 && (
                        <span className="truncate pl-2.5 text-[8px] font-medium leading-3 text-[var(--color-muted)]">
                          +{dateEvents.length - 3} more
                        </span>
                      )}
                    </span>
                    {examEvent ? (
                      <span className="absolute right-1 top-1 hidden rounded-full border border-[color-mix(in_srgb,var(--color-accent)_24%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-accent)_10%,var(--color-panel))] px-1.5 py-0.5 text-[8px] font-semibold text-[var(--color-accent)] sm:block">
                        {examCountdown(examEvent.dueDate, today)}
                      </span>
                    ) : dateEvents.length > 0 ? (
                      <span className="absolute right-1 top-1 hidden rounded-full bg-[var(--color-panel-subtle)] px-1.5 py-0.5 text-[8px] font-semibold text-[var(--color-muted)] sm:block">
                        {dateEvents.length}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="flex h-full min-w-0 flex-col gap-4">
            <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3.5 sm:p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                    Your agenda
                  </p>
                  <h2 className="mt-0.5 font-serif text-lg font-semibold leading-tight text-[var(--color-ink)]">
                    {formatLongDate(selectedDate)}
                  </h2>
                </div>
                <CalendarDays size={17} className="mt-1 shrink-0 text-[var(--color-success)]" />
              </div>

              {selectedEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 py-3.5">
                  <p className="font-serif text-sm text-[var(--color-ink)]">
                    {workspaceFilterId
                      ? "No events for this workspace."
                      : "Nothing scheduled yet."}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                    Add a task or study block below.
                  </p>
                </div>
              ) : (
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
                  {selectedEvents.map((event) => {
                    const isEditing = editingEventId === event.id;
                    const linkedWorkspace =
                      activeWorkspaces.find(
                        (workspace) => workspace.id === event.workspaceId
                      ) ?? null;
                    return (
                      <article
                        key={event.id}
                        className={`group rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-2.5 transition-colors duration-150 ${
                          event.isCompleted ? "opacity-65" : "hover:bg-[var(--color-hover)]"
                        }`}
                      >
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              autoFocus
                              value={draftTitle}
                              onChange={(e) => setDraftTitle(e.target.value)}
                              aria-label="Event title"
                              className="h-9 w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-panel)] px-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                            />
                            <div className="flex items-center gap-2">
                              <input
                                type="date"
                                value={dateInputValue(draftDate)}
                                onChange={(e) => setDraftDate(e.target.value)}
                                aria-label="Event date"
                                className="h-8 min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                              />
                              <button
                                type="button"
                                onClick={() => void saveEdit(event)}
                                className="grid h-8 w-8 place-items-center rounded-md bg-[var(--color-accent-button)] text-[var(--color-accent-foreground)] hover:brightness-95"
                                aria-label="Save changes"
                              >
                                <Check size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingEventId(null)}
                                className="grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
                                aria-label="Cancel editing"
                              >
                                <X size={15} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start gap-2.5">
                              <button
                                type="button"
                                onClick={() => void toggleEvent(event)}
                                aria-label={
                                  event.isCompleted
                                    ? "Mark as not completed"
                                    : "Mark as completed"
                                }
                                className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors duration-150 ${
                                  event.isCompleted
                                    ? "border-[var(--color-success)] bg-[var(--color-success)] text-[var(--color-accent-foreground)]"
                                    : "border-[var(--color-border-strong)] text-transparent hover:border-[var(--color-success)]"
                                }`}
                              >
                                {event.isCompleted && <Check size={11} />}
                              </button>
                              <span
                                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: EVENT_DOT_COLORS[event.eventType],
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className="rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em]"
                                    style={eventToneStyle(event.eventType)}
                                  >
                                    {EVENT_LABELS[event.eventType]}
                                  </span>
                                  {event.eventType === "exam" && (
                                    <span className="rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-1.5 py-0.5 text-[8px] font-semibold text-[var(--color-muted)]">
                                      {examCountdown(event.dueDate, today)}
                                    </span>
                                  )}
                                </div>
                                <h3
                                  className={`mt-1.5 break-words text-[13px] font-semibold leading-snug text-[var(--color-ink)] ${
                                    event.isCompleted ? "line-through" : ""
                                  }`}
                                >
                                  {event.title}
                                </h3>
                                {event.dueTime && (
                                  <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-[var(--color-panel)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]">
                                    <Clock3 size={11} />
                                    {formatTime(event.dueTime)}
                                  </p>
                                )}
                                {(event.workspaceTitle || event.quizTitle) && (
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                    {event.workspaceTitle && (
                                      <span className="inline-flex max-w-full items-center rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-0.5 text-[9px] text-[var(--color-muted)]">
                                        <span className="truncate">
                                          {event.workspaceTitle}
                                        </span>
                                      </span>
                                    )}
                                    {event.quizTitle && (
                                      <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-0.5 text-[9px] text-[var(--color-muted)]">
                                          <Link2 size={11} />
                                          <span className="truncate">
                                            {event.quizTitle}
                                          </span>
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => beginEdit(event)}
                                  aria-label="Edit event"
                                  className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeEvent(event)}
                                  aria-label="Delete event"
                                  className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-accent)]"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                            {(event.quizId || linkedWorkspace) && (
                              <div className="mt-2 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-2 pl-[31px]">
                                {linkedWorkspace && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenWorkspace(linkedWorkspace.id)}
                                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-success)] hover:text-[var(--color-ink)]"
                                  >
                                    Open <ArrowRight size={12} />
                                  </button>
                                )}
                                {event.quizId && event.workspaceId && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onStartQuiz(event.workspaceId!, event.quizId!)
                                    }
                                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-ink)]"
                                  >
                                    Start Quiz <ArrowRight size={12} />
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
              <div className="relative mt-3 border-t border-[var(--color-border)] pt-3">
                <form
                  onSubmit={(event) => void saveNewEvent(event)}
                  className="flex min-w-0 items-center gap-2"
                >
                  <input
                    value={formTitle}
                    onChange={(event) => setFormTitle(event.target.value)}
                    maxLength={160}
                    placeholder="Add a task, study block, or deadline..."
                    aria-label="Quick-add event title"
                    className="h-9 min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-2.5 text-xs text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
                  />
                  <button
                    type="submit"
                    disabled={isSaving || !formTitle.trim()}
                    aria-label="Add calendar event"
                    title="Add event (Enter)"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[var(--color-accent-button)] text-[var(--color-accent-foreground)] transition-colors duration-150 hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSaving ? (
                      <LoaderCircle size={14} className="animate-spin" />
                    ) : (
                      <Plus size={15} />
                    )}
                  </button>
                </form>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <div className="relative">
                    <button
                      type="button"
                      aria-expanded={quickPopover === "type"}
                      onClick={() =>
                        setQuickPopover((current) =>
                          current === "type" ? null : "type"
                        )
                      }
                      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 text-[10px] font-medium text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
                    >
                      Type · {EVENT_LABELS[formType]}
                      <ChevronDown size={11} />
                    </button>
                    {quickPopover === "type" && (
                      <div
                        role="dialog"
                        aria-label="Choose event type"
                        className="absolute left-0 top-full z-30 mt-1.5 w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-1 shadow-[0_8px_24px_color-mix(in_srgb,var(--color-ink)_10%,transparent)]"
                      >
                        {CALENDAR_EVENT_TYPES.map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => {
                              setFormType(type);
                              setQuickPopover(null);
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--color-ink)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: EVENT_DOT_COLORS[type] }}
                            />
                            {EVENT_LABELS[type]}
                            {formType === type && (
                              <Check size={12} className="ml-auto text-[var(--color-success)]" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      aria-expanded={quickPopover === "time"}
                      onClick={() =>
                        setQuickPopover((current) =>
                          current === "time" ? null : "time"
                        )
                      }
                      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 text-[10px] font-medium text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
                    >
                      <Clock3 size={11} />
                      {formTime ? formatTime(formTime) : "Time"}
                    </button>
                    {quickPopover === "time" && (
                      <div
                        role="dialog"
                        aria-label="Choose event time"
                        className="absolute left-0 top-full z-30 mt-1.5 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-2 shadow-[0_8px_24px_color-mix(in_srgb,var(--color-ink)_10%,transparent)]"
                      >
                        <input
                          type="time"
                          value={formTime}
                          onChange={(event) => setFormTime(event.target.value)}
                          aria-label="Optional event time"
                          className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-2 text-[11px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                        />
                        {formTime && (
                          <button
                            type="button"
                            onClick={() => setFormTime("")}
                            aria-label="Clear event time"
                            className="rounded px-1 text-[10px] text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
                          >
                            Clear
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setQuickPopover(null)}
                          aria-label="Done choosing time"
                          className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
                        >
                          <Check size={13} />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      aria-expanded={quickPopover === "workspace"}
                      onClick={() =>
                        setQuickPopover((current) =>
                          current === "workspace" ? null : "workspace"
                        )
                      }
                      className="inline-flex h-7 max-w-[150px] items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 text-[10px] font-medium text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
                    >
                      <span className="truncate">
                        {activeWorkspaces.find(
                          (workspace) => workspace.id === formWorkspaceId
                        )?.title ?? "Workspace"}
                      </span>
                      <ChevronDown size={11} className="shrink-0" />
                    </button>
                    {quickPopover === "workspace" && (
                      <div
                        role="dialog"
                        aria-label="Choose workspace"
                        className="absolute left-0 top-full z-30 mt-1.5 max-h-52 w-56 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-1 shadow-[0_8px_24px_color-mix(in_srgb,var(--color-ink)_10%,transparent)]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            handleWorkspaceChange("");
                            setQuickPopover(null);
                          }}
                          className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
                        >
                          No workspace
                        </button>
                        {activeWorkspaces.map((workspace) => (
                          <button
                            key={workspace.id}
                            type="button"
                            onClick={() => {
                              handleWorkspaceChange(workspace.id);
                              setQuickPopover(null);
                            }}
                            className="w-full truncate rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
                          >
                            {workspace.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      aria-expanded={quickPopover === "quiz"}
                      onClick={() =>
                        setQuickPopover((current) =>
                          current === "quiz" ? null : "quiz"
                        )
                      }
                      className="inline-flex h-7 max-w-[150px] items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 text-[10px] font-medium text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
                    >
                      <span className="truncate">
                        {quizOptions.find((option) => option.id === formQuizId)
                          ?.title ?? "Quiz"}
                      </span>
                      <ChevronDown size={11} className="shrink-0" />
                    </button>
                    {quickPopover === "quiz" && (
                      <div
                        role="dialog"
                        aria-label="Choose quiz"
                        className="absolute right-0 top-full z-30 mt-1.5 max-h-52 w-60 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-1 shadow-[0_8px_24px_color-mix(in_srgb,var(--color-ink)_10%,transparent)]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            chooseQuiz("");
                            setQuickPopover(null);
                          }}
                          className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
                        >
                          No quiz
                        </button>
                        {quizOptions
                          .filter(
                            (option) =>
                              !formWorkspaceId ||
                              option.workspaceId === formWorkspaceId
                          )
                          .map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                chooseQuiz(option.id);
                                setQuickPopover(null);
                              }}
                              className="w-full truncate rounded-md px-2 py-1.5 text-left text-[11px] text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
                            >
                              {option.workspaceTitle} · {option.title}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
                {formError && (
                  <p role="alert" className="mt-2 text-[10px] text-[var(--color-accent)]">
                    {formError}
                  </p>
                )}
              </div>
            </section>

            {upcomingExams.length > 0 && (
              <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3.5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                    Coming up
                  </p>
                  <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-0.5 text-[9px] font-semibold text-[var(--color-muted)]">
                    {upcomingExams.length} {upcomingExams.length === 1 ? "exam" : "exams"}
                  </span>
                </div>
                <div className="space-y-2">
                  {upcomingExams.map((exam) => (
                    <div
                      key={exam.id}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-[var(--color-hover)]"
                    >
                      <button
                        type="button"
                        onClick={() => selectDate(parseLocalIsoDate(exam.dueDate))}
                        className="min-w-0 flex-1 text-left"
                      >
                          <span className="block truncate text-xs font-semibold text-[var(--color-ink)]">
                          {exam.title}
                        </span>
                          <span className="mt-0.5 block text-[10px] text-[var(--color-muted)]">
                          {formatLongDate(exam.dueDate)}
                        </span>
                      </button>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className="rounded-md border px-2 py-1 text-[9px] font-semibold"
                            style={eventToneStyle("exam")}
                          >
                          {examCountdown(exam.dueDate, today)}
                        </span>
                        {exam.workspaceId &&
                          (() => {
                            const workspace = activeWorkspaces.find(
                              (active) => active.id === exam.workspaceId
                            );
                            if (!workspace) return null;
                            const daysRemaining = differenceInIsoDays(
                              today,
                              exam.dueDate
                            );
                            const conceptsPerDay =
                              daysRemaining > 0
                                ? Math.ceil(
                                    workspace.unmasteredCount / daysRemaining
                                  )
                                : 0;
                            const isDisabled =
                              daysRemaining <= 0 ||
                              conceptsPerDay <= 0 ||
                              pacingExamId === exam.id;
                            return (
                              <button
                                type="button"
                                disabled={isDisabled}
                                onClick={() =>
                                  void createExamPacingPlan(exam, workspace)
                                }
                                className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-[9px] font-semibold text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                                title={
                                  daysRemaining <= 0
                                    ? "No days remain before this exam"
                                    : conceptsPerDay <= 0
                                      ? "No unmastered concepts to pace"
                                      : `${conceptsPerDay} concepts per day`
                                }
                              >
                                {pacingExamId === exam.id
                                  ? "Creating targets…"
                                  : "Generate Daily Study Targets"}
                              </button>
                            );
                          })()}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeWorkspaces.length > 0 && (
              <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3.5">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
                    Active workspaces
                  </p>
                  <button
                    type="button"
                    aria-pressed={!workspaceFilterId}
                    onClick={() => setWorkspaceFilterId(null)}
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold transition-colors duration-150 ${
                      workspaceFilterId
                        ? "border-[var(--color-border)] bg-[var(--color-panel-subtle)] text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
                        : "border-[var(--color-border-strong)] bg-[var(--color-selected)] text-[var(--color-ink)]"
                    }`}
                  >
                    All
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeWorkspaces.map((workspace) => {
                    const isActive = workspaceFilterId === workspace.id;
                    return (
                      <div
                        key={workspace.id}
                        className={`group flex max-w-full items-center rounded-full border transition-colors duration-150 ${
                          isActive
                            ? "border-[var(--color-border-strong)] bg-[var(--color-selected)]"
                            : "border-[var(--color-border)] bg-[var(--color-panel-subtle)] hover:bg-[var(--color-hover)]"
                        }`}
                      >
                        <button
                          type="button"
                          aria-pressed={isActive}
                          onClick={() =>
                            setWorkspaceFilterId((current) =>
                              current === workspace.id ? null : workspace.id
                            )
                          }
                          className="inline-flex min-w-0 items-center gap-1.5 py-1 pl-2.5 pr-1 text-[10px] font-medium text-[var(--color-ink)]"
                          title={`Filter calendar by ${workspace.title}`}
                        >
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: workspaceColors.get(workspace.id),
                            }}
                          />
                          <span className="max-w-[150px] truncate">
                            {workspace.title}
                          </span>
                          <span className="shrink-0 text-[9px] text-[var(--color-muted)]">
                            {workspace.unmasteredCount}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Quick schedule for ${workspace.title}`}
                          title={`Quick schedule for ${workspace.title}`}
                          onClick={() => startAdd(selectedDate, workspace.id)}
                          className="mr-1 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[var(--color-muted)] opacity-100 transition-opacity duration-150 hover:bg-[var(--color-panel)] hover:text-[var(--color-ink)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>

      {isAdding && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-ink)_35%,transparent)] p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSaving) setIsAdding(false);
          }}
        >
          <form
            onSubmit={(event) => void saveNewEvent(event)}
            className="w-full max-w-[460px] rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-[0_12px_36px_color-mix(in_srgb,var(--color-ink)_12%,transparent)]"
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-[var(--color-muted)]">
                  Make a plan
                </p>
                <h2 className="mt-1 font-serif text-xl font-semibold text-[var(--color-ink)]">
                  New calendar event
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                disabled={isSaving}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
              >
                <X size={17} />
              </button>
            </div>

            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-semibold text-[var(--color-ink)]">
                Title
              </span>
              <input
                autoFocus
                value={formTitle}
                onChange={(event) => setFormTitle(event.target.value)}
                placeholder="e.g. Review cellular respiration"
                maxLength={180}
                className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 text-sm text-[var(--color-ink)] outline-none transition-colors duration-150 placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-semibold text-[var(--color-ink)]">
                Notes <span className="font-normal text-[var(--color-muted)]">optional</span>
              </span>
              <textarea
                value={formNotes}
                onChange={(event) => setFormNotes(event.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Add context or a reminder"
                className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
              />
            </label>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1.5 block text-xs font-semibold text-[var(--color-ink)]">
                  Type
                </span>
                <span className="relative block">
                  <select
                    value={formType}
                    onChange={(event) =>
                      setFormType(event.target.value as CalendarEventType)
                    }
                    className="h-10 w-full appearance-none rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] pl-3 pr-8 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                  >
                    {CALENDAR_EVENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {EVENT_LABELS[type]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-3 top-3 text-[var(--color-muted)]"
                  />
                </span>
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold text-[var(--color-ink)]">
                  Date
                </span>
                <input
                  type="date"
                  value={dateInputValue(formDate)}
                  onChange={(event) => setFormDate(event.target.value)}
                  className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <label>
                <span className="mb-1.5 block text-xs font-semibold text-[var(--color-ink)]">
                  Time <span className="font-normal text-[var(--color-muted)]">optional</span>
                </span>
                <input
                  type="time"
                  value={formTime}
                  onChange={(event) => setFormTime(event.target.value)}
                  className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold text-[var(--color-ink)]">
                  Workspace
                </span>
                <span className="relative block">
                  <select
                    value={formWorkspaceId}
                    onChange={(event) => handleWorkspaceChange(event.target.value)}
                    className="h-10 w-full appearance-none rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] pl-3 pr-8 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="">No workspace</option>
                    {activeWorkspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.title}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-3 top-3 text-[var(--color-muted)]"
                  />
                </span>
              </label>
            </div>

            <label className="mb-4 block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
                <Link2 size={13} />
                Link a quiz <span className="font-normal text-[var(--color-muted)]">optional</span>
              </span>
              <span className="relative block">
                <select
                  value={formQuizId}
                  onChange={(event) => chooseQuiz(event.target.value)}
                  className="h-10 w-full appearance-none rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] pl-3 pr-8 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                >
                  <option value="">No quiz linked</option>
                  {quizOptions
                    .filter(
                      (option) =>
                        !formWorkspaceId || option.workspaceId === formWorkspaceId
                    )
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.workspaceTitle} · {option.title}
                      </option>
                    ))}
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute right-3 top-3 text-[var(--color-muted)]"
                />
              </span>
            </label>

            {formError && (
              <p role="alert" className="mb-3 text-xs font-medium text-[var(--color-accent)]">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsAdding(false)}
                className="h-9 rounded-lg px-3 text-sm font-medium text-[var(--color-muted)] transition-colors duration-150 hover:bg-[var(--color-hover)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--color-accent-button)] px-4 text-sm font-semibold text-[var(--color-accent-foreground)] transition-colors duration-150 hover:brightness-95 disabled:opacity-60"
              >
                {isSaving && <LoaderCircle size={14} className="animate-spin" />}
                Save event
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
