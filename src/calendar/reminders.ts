import type { CalendarEvent } from "./types";

export const CALENDAR_REMINDER_LEAD_MS = 15 * 60 * 1000;
export const CALENDAR_REMINDER_GRACE_MS = 60 * 1000;

export interface CalendarReminder {
  key: string;
  title: string;
  body: string;
  fireAt: number;
}

export function getCalendarReminderOccurrences(
  event: CalendarEvent
): CalendarReminder[] {
  if (event.isCompleted) return [];

  const [year, month, day] = event.dueDate.split("-").map(Number);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return [];
  }

  const dueAt = new Date(year, month - 1, day);
  if (
    dueAt.getFullYear() !== year ||
    dueAt.getMonth() !== month - 1 ||
    dueAt.getDate() !== day
  ) {
    return [];
  }

  const time = event.dueTime?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (event.dueTime && !time) return [];
  dueAt.setHours(time ? Number(time[1]) : 9, time ? Number(time[2]) : 0, 0, 0);

  const dueAtKey = dueAt.toISOString();
  const dueLabel = dueAt.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const details = [
    event.eventType.replace(/_/g, " "),
    `Due ${dueLabel}`,
    event.workspaceTitle,
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    {
      key: `${event.id}:${dueAtKey}:15m`,
      title: `In 15 minutes: ${event.title}`,
      body: details,
      fireAt: dueAt.getTime() - CALENDAR_REMINDER_LEAD_MS,
    },
    {
      key: `${event.id}:${dueAtKey}:due`,
      title: `Due now: ${event.title}`,
      body: details,
      fireAt: dueAt.getTime(),
    },
  ];
}

export function getDueCalendarReminders(
  events: CalendarEvent[],
  now: Date,
  sentKeys: ReadonlySet<string>
): CalendarReminder[] {
  const nowMs = now.getTime();
  return events
    .flatMap(getCalendarReminderOccurrences)
    .filter(
      (reminder) =>
        !sentKeys.has(reminder.key) &&
        reminder.fireAt <= nowMs &&
        nowMs - reminder.fireAt <= CALENDAR_REMINDER_GRACE_MS
    );
}
