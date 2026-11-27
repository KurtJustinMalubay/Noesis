import {
  CALENDAR_REMINDER_LEAD_MS,
  getCalendarReminderOccurrences,
  getDueCalendarReminders,
} from "../src/calendar/reminders.ts";
import type { CalendarEvent } from "../src/calendar/types.ts";

const event: CalendarEvent = {
  id: "event-1",
  title: "Review biology",
  eventType: "study_session",
  dueDate: "2030-01-02",
  dueTime: "10:30",
  notes: null,
  workspaceId: "workspace-1",
  workspaceTitle: "Biology",
  workspaceColor: null,
  quizId: null,
  quizTitle: null,
  quizScore: null,
  isCompleted: false,
  source: "manual",
  createdAt: "2030-01-01T00:00:00.000Z",
};

const occurrences = getCalendarReminderOccurrences(event);
const expectedDue = new Date(2030, 0, 2, 10, 30).getTime();
if (
  occurrences.length !== 2 ||
  occurrences[0].fireAt !== expectedDue - CALENDAR_REMINDER_LEAD_MS ||
  occurrences[1].fireAt !== expectedDue
) {
  throw new Error("Timed events should remind 15 minutes before and at the due time.");
}

const upcoming = getDueCalendarReminders(
  [event],
  new Date(expectedDue - CALENDAR_REMINDER_LEAD_MS),
  new Set()
);
if (upcoming.length !== 1 || upcoming[0].title !== "In 15 minutes: Review biology") {
  throw new Error("The pre-event reminder should be due at the configured lead time.");
}

const atDueTime = getDueCalendarReminders(
  [event],
  new Date(expectedDue),
  new Set([occurrences[0].key])
);
if (atDueTime.length !== 1 || atDueTime[0].title !== "Due now: Review biology") {
  throw new Error("The due-time reminder should be sent once and respect prior sends.");
}

const dateOnly = getCalendarReminderOccurrences({
  ...event,
  dueTime: null,
});
const expectedDateOnlyDue = new Date(2030, 0, 2, 9, 0).getTime();
if (
  dateOnly.length !== 2 ||
  dateOnly[0].fireAt !== expectedDateOnlyDue - CALENDAR_REMINDER_LEAD_MS ||
  dateOnly[1].fireAt !== expectedDateOnlyDue
) {
  throw new Error("Date-only events should remind at 8:45 AM and 9:00 AM local time.");
}

if (getCalendarReminderOccurrences({ ...event, isCompleted: true }).length !== 0) {
  throw new Error("Completed calendar events must not schedule reminders.");
}

console.log("Calendar reminder scheduling passed.");
