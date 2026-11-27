export const CALENDAR_EVENT_TYPES = [
  "exam",
  "deadline",
  "quiz_due",
  "study_session",
  "todo",
] as const;

export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export interface CalendarEventInput {
  id?: string;
  title: string;
  notes?: string | null;
  eventType: CalendarEventType;
  dueDate: string;
  dueTime?: string | null;
  workspaceId?: string | null;
  quizId?: string | null;
  isCompleted?: boolean;
  source?: string;
}

export interface CalendarEvent extends CalendarEventInput {
  id: string;
  notes: string | null;
  dueTime: string | null;
  workspaceId: string | null;
  workspaceTitle: string | null;
  workspaceColor: string | null;
  quizId: string | null;
  quizTitle: string | null;
  quizScore: number | null;
  isCompleted: boolean;
  source: string;
  createdAt: string;
}

export interface CalendarQuizOption {
  id: string;
  title: string;
  workspaceId: string;
  workspaceTitle: string;
  score: number | null;
}
