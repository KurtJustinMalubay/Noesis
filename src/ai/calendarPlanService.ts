import {
  generateGeminiJson,
  getLocalOutputTokenBudget,
  isLocalAiEndpoint,
} from "./geminiClient.ts";
import { loadAiSettings } from "./keyStore.ts";
import { CALENDAR_EVENT_TYPES } from "../calendar/types.ts";
import type { CalendarEventInput } from "../calendar/types.ts";
import {
  parseStudyPlanResponse,
  type ParsedStudyPlan,
} from "../calendar/studyPlan.ts";

export interface StudyPlanWorkspace {
  id: string;
  title: string;
  unmasteredCount: number;
}

interface GenerateCalendarStudyPlanOptions {
  request: string;
  today: string;
  workspaces: StudyPlanWorkspace[];
  signal?: AbortSignal;
}

const STUDY_PLAN_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  required: ["summary", "events"],
  properties: {
    summary: { type: "STRING" },
    events: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: [
          "title",
          "notes",
          "eventType",
          "dueDate",
          "dueTime",
          "workspaceId",
          "quizId",
        ],
        properties: {
          title: { type: "STRING" },
          notes: { type: "STRING" },
          eventType: { type: "STRING", enum: [...CALENDAR_EVENT_TYPES] },
          dueDate: { type: "STRING" },
          dueTime: { type: "STRING" },
          workspaceId: { type: "STRING" },
          quizId: { type: "STRING" },
        },
      },
    },
  },
};

function getRelevantWorkspaces(
  request: string,
  workspaces: StudyPlanWorkspace[],
  limit: number
): StudyPlanWorkspace[] {
  const terms = new Set(
    request
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((term) => term.length > 2) ?? []
  );
  return workspaces
    .map((workspace, index) => {
      const titleTerms =
        workspace.title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const relevance = titleTerms.reduce(
        (score, term) => score + (terms.has(term) ? 1 : 0),
        0
      );
      return { workspace, index, relevance };
    })
    .sort(
      (left, right) =>
        right.relevance - left.relevance || left.index - right.index
    )
    .slice(0, limit)
    .map(({ workspace }) => ({
      id: workspace.id,
      title: workspace.title.slice(0, 100),
      unmasteredCount: Math.max(0, workspace.unmasteredCount),
    }));
}

function normalizeOptionalFields(plan: ParsedStudyPlan): ParsedStudyPlan {
  const events: CalendarEventInput[] = plan.events.map((event) => ({
    ...event,
    notes: event.notes?.trim() || null,
    dueTime: event.dueTime?.trim() || null,
    workspaceId: event.workspaceId?.trim() || null,
    quizId: event.quizId?.trim() || null,
  }));
  return { ...plan, events };
}

export async function generateCalendarStudyPlan({
  request,
  today,
  workspaces,
  signal,
}: GenerateCalendarStudyPlanOptions): Promise<ParsedStudyPlan> {
  const settings = loadAiSettings();
  const isLocalModel =
    settings.provider === "openai-compatible" &&
    isLocalAiEndpoint(settings.localBaseUrl);
  const outputTokenBudget = isLocalModel
    ? getLocalOutputTokenBudget(Math.min(2048, settings.localMaxOutputTokens))
    : 4096;
  const maxEvents = Math.max(
    1,
    Math.min(
      isLocalModel ? 12 : 24,
      Math.floor((outputTokenBudget - 250) / 125)
    )
  );
  const selectedWorkspaces = getRelevantWorkspaces(
    request,
    workspaces,
    isLocalModel ? 16 : 40
  );
  const workspaceIds = selectedWorkspaces.map((workspace) => workspace.id);
  const basePrompt = [
    `Request: ${request.trim()}`,
    `Today's local date: ${today}`,
    `Active workspaces: ${JSON.stringify(selectedWorkspaces)}`,
    `Create no more than ${maxEvents} useful calendar events. If no time range is specified, plan within the next 7 days. Do not schedule events in the past. Include an exam or deadline only when the request clearly mentions one; otherwise use study_session or todo. Spread study sessions across days and avoid duplicate events.`,
    `Return eventType from ${JSON.stringify(CALENDAR_EVENT_TYPES)}. dueDate must be a real local calendar date in YYYY-MM-DD format. dueTime must be HH:MM or an empty string. Set notes to a short useful note or an empty string. Set workspaceId to an ID from the active workspace list or an empty string. Set quizId to an empty string because no quiz IDs were provided.`,
  ].join("\n");
  let validationError = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) {
      throw new DOMException("Study plan generation stopped.", "AbortError");
    }

    const response = await generateGeminiJson<unknown>({
      tier: "fast",
      temperature: attempt === 0 ? (isLocalModel ? 0.1 : 0.2) : 0,
      maxOutputTokens: outputTokenBudget,
      systemInstruction:
        "Create a practical, concise study calendar plan. Return only the required JSON object. Use only the supplied workspace IDs. Keep event titles short and notes to one sentence. Do not invent exams, deadlines, quiz IDs, or facts about the learner.",
      userPrompt:
        attempt === 0
          ? basePrompt
          : `${basePrompt}\n\nThe previous response failed validation: ${validationError}. Correct the issue and return a complete valid plan.`,
      jsonSchema: STUDY_PLAN_RESPONSE_SCHEMA,
      signal,
      rateLimitMode: "fail-fast",
    });

    try {
      const parsed = normalizeOptionalFields(
        parseStudyPlanResponse(JSON.stringify(response), { workspaceIds })
      );
      if (parsed.events.length > maxEvents) {
        throw new Error(
          `The plan included more than the ${maxEvents} event limit.`
        );
      }
      if (
        parsed.events.some(
          (event) => event.dueDate < today && !/past|history|reviewed/i.test(request)
        )
      ) {
        throw new Error("The plan included dates before today.");
      }
      return parsed;
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        throw new Error(
          `Study plan validation failed after one correction attempt: ${validationError}`
        );
      }
    }
  }

  throw new Error("Study plan generation did not return a valid plan.");
}
