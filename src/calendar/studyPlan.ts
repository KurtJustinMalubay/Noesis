import { CALENDAR_EVENT_TYPES } from "./types.ts";
import type { CalendarEventInput } from "./types.ts";
import { toLocalIsoDate } from "./dateUtils.ts";

export interface ParsedStudyPlan {
  summary: string;
  events: CalendarEventInput[];
}

export interface StudyPlanValidationOptions {
  workspaceIds: readonly string[];
  quizIds?: readonly string[];
}

function extractJsonObject(raw: string): string {
  const fenced = raw
    .trim()
    .match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  if (start < 0) throw new Error("No JSON plan object was returned.");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, index + 1);
    }
  }
  throw new Error("The JSON plan object is incomplete.");
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return toLocalIsoDate(new Date(year, month - 1, day)) === value;
}

export function parseStudyPlanResponse(
  raw: string,
  options: StudyPlanValidationOptions
): ParsedStudyPlan {
  const parsed: unknown = JSON.parse(extractJsonObject(raw));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The study plan must be a JSON object.");
  }

  const result = parsed as Record<string, unknown>;
  if (
    typeof result.summary !== "string" ||
    !result.summary.trim() ||
    !Array.isArray(result.events)
  ) {
    throw new Error("The study plan is missing its summary or events array.");
  }

  const allowedWorkspaceIds = new Set(options.workspaceIds);
  const allowedQuizIds = new Set(options.quizIds ?? []);
  const events = result.events.map((value, index): CalendarEventInput => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Study plan event ${index + 1} must be an object.`);
    }

    const event = value as Record<string, unknown>;
    const title = typeof event.title === "string" ? event.title.trim() : "";
    const eventType = event.eventType;
    const dueDate = event.dueDate;
    const dueTime =
      typeof event.dueTime === "string" && !event.dueTime.trim()
        ? null
        : event.dueTime ?? null;
    const workspaceId =
      typeof event.workspaceId === "string" && !event.workspaceId.trim()
        ? null
        : event.workspaceId ?? null;
    const quizId =
      typeof event.quizId === "string" && !event.quizId.trim()
        ? null
        : event.quizId ?? null;
    const notes =
      typeof event.notes === "string" && !event.notes.trim()
        ? null
        : event.notes ?? null;

    if (!title || title.length > 160) {
      throw new Error(`Study plan event ${index + 1} has an invalid title.`);
    }
    if (
      typeof eventType !== "string" ||
      !CALENDAR_EVENT_TYPES.includes(
        eventType as (typeof CALENDAR_EVENT_TYPES)[number]
      )
    ) {
      throw new Error(`Study plan event ${index + 1} has an invalid type.`);
    }
    if (typeof dueDate !== "string" || !isValidIsoDate(dueDate)) {
      throw new Error(`Study plan event ${index + 1} has an invalid date.`);
    }
    if (
      dueTime !== null &&
      (typeof dueTime !== "string" ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime))
    ) {
      throw new Error(`Study plan event ${index + 1} has an invalid time.`);
    }
    if (
      workspaceId !== null &&
      (typeof workspaceId !== "string" ||
        !allowedWorkspaceIds.has(workspaceId))
    ) {
      throw new Error(
        `Study plan event ${index + 1} links to an unknown workspace.`
      );
    }
    if (
      quizId !== null &&
      (typeof quizId !== "string" || !allowedQuizIds.has(quizId))
    ) {
      throw new Error(`Study plan event ${index + 1} links to an unknown quiz.`);
    }
    if (notes !== null && typeof notes !== "string") {
      throw new Error(`Study plan event ${index + 1} has invalid notes.`);
    }

    return {
      title,
      notes,
      eventType: eventType as CalendarEventInput["eventType"],
      dueDate,
      dueTime,
      workspaceId,
      quizId,
      source: "ai_plan",
    };
  });

  if (events.length === 0) {
    throw new Error("The study plan did not include any events.");
  }

  return { summary: result.summary.trim(), events };
}
