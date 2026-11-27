import { useCallback, useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { CalendarDays, Check, ExternalLink, X } from "lucide-react";
import { getCalendarEvents, toggleCalendarEvent } from "../db/repositories/calendarRepo";
import { addIsoDays, toLocalIsoDate } from "../calendar/dateUtils";
import type { CalendarEvent } from "../calendar/types";

function MiniEventRow({
  event,
  onToggle,
  onStartQuiz,
}: {
  event: CalendarEvent;
  onToggle: (event: CalendarEvent) => void;
  onStartQuiz: (event: CalendarEvent) => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-[var(--color-border)] py-2 last:border-b-0">
      <button
        type="button"
        aria-label={
          event.isCompleted
            ? `Mark ${event.title} incomplete`
            : `Complete ${event.title}`
        }
        onClick={() => onToggle(event)}
        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
          event.isCompleted
            ? "border-[var(--color-success)] bg-[var(--color-success)] text-white"
            : "border-[var(--color-border-strong)] text-transparent hover:border-[var(--color-success)]"
        }`}
      >
        {event.isCompleted && <Check className="h-3 w-3" />}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[11px] font-medium ${
            event.isCompleted
              ? "text-[var(--color-muted)] line-through"
              : "text-[var(--color-ink)]"
          }`}
        >
          {event.title}
        </p>
        <p className="mt-0.5 truncate text-[9px] text-[var(--color-muted)]">
          {event.dueTime ?? event.eventType.replace("_", " ")}
          {event.workspaceTitle ? ` · ${event.workspaceTitle}` : ""}
        </p>
      </div>
      {event.quizId && event.workspaceId && (
        <button
          type="button"
          onClick={() => onStartQuiz(event)}
          className="shrink-0 rounded px-1.5 py-1 text-[9px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
        >
          Quiz →
        </button>
      )}
    </div>
  );
}

export function MiniAgendaView() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshEvents = useCallback(async () => {
    const today = toLocalIsoDate(new Date());
    try {
      const loaded = await getCalendarEvents(
        "0001-01-01",
        addIsoDays(today, 1)
      );
      setEvents(loaded.filter((event) => !event.isCompleted));
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError)
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshEvents();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen("calendar:updated", () => void refreshEvents())
      .then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      })
      .catch((listenError: unknown) =>
        setError(
          listenError instanceof Error
            ? listenError.message
            : String(listenError)
        )
      );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshEvents]);

  const handleToggle = async (event: CalendarEvent) => {
    try {
      await toggleCalendarEvent(event.id);
      await refreshEvents();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error ? toggleError.message : String(toggleError)
      );
    }
  };

  const openMain = async () => {
    const mainWindow = await Window.getByLabel("main");
    if (!mainWindow) {
      setError("The main Noesis window is unavailable.");
      return;
    }
    await mainWindow.show();
    await mainWindow.setFocus();
  };

  const closeWindow = async () => {
    await getCurrentWindow().close();
  };

  const startQuiz = async (event: CalendarEvent) => {
    if (!event.quizId || !event.workspaceId) return;
    await emit("calendar:open-quiz", {
      workspaceId: event.workspaceId,
      nodeId: event.quizId,
    });
    await openMain();
  };

  const today = toLocalIsoDate(new Date());
  const overdue = events.filter((event) => event.dueDate < today);
  const todays = events.filter((event) => event.dueDate === today);

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--color-app-bg)] text-[var(--color-ink)]">
      <header
        data-tauri-drag-region
        className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2.5"
      >
        <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
          <h1 className="truncate text-xs font-semibold">Mini Agenda</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void openMain()}
            aria-label="Open Noesis"
            title="Open Noesis"
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void closeWindow()}
            aria-label="Close Mini Agenda"
            title="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-[10px] text-[var(--color-warning)]"
          >
            {error}
          </p>
        )}
        {isLoading ? (
          <p className="py-6 text-center text-[10px] text-[var(--color-muted)]">
            Loading agenda…
          </p>
        ) : (
          <>
            <section>
              <h2 className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-warning)]">
                Overdue
              </h2>
              {overdue.length ? (
                overdue.map((event) => (
                  <MiniEventRow
                    key={event.id}
                    event={event}
                    onToggle={(item) => void handleToggle(item)}
                    onStartQuiz={(item) => void startQuiz(item)}
                  />
                ))
              ) : (
                <p className="py-2 text-[10px] text-[var(--color-muted)]">
                  Nothing overdue.
                </p>
              )}
            </section>
            <section className="mt-4">
              <h2 className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
                Today
              </h2>
              {todays.length ? (
                todays.map((event) => (
                  <MiniEventRow
                    key={event.id}
                    event={event}
                    onToggle={(item) => void handleToggle(item)}
                    onStartQuiz={(item) => void startQuiz(item)}
                  />
                ))
              ) : (
                <p className="py-2 text-[10px] text-[var(--color-muted)]">
                  No plans for today.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
