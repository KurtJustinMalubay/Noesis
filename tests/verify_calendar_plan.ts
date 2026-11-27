import { parseStudyPlanResponse } from "../src/calendar/studyPlan.ts";
import { generateCalendarStudyPlan } from "../src/ai/calendarPlanService.ts";

const parsed = parseStudyPlanResponse(
  `Schedule overview
\`\`\`json
{
  "summary": "Review the core topics this week.",
  "events": [{
    "title": "Review algorithms",
    "notes": null,
    "eventType": "study_session",
    "dueDate": "2026-12-01",
    "dueTime": "09:30",
    "workspaceId": "workspace-1",
    "quizId": null
  }]
}
\`\`\``,
  { workspaceIds: ["workspace-1"] }
);
if (
  parsed.events.length !== 1 ||
  parsed.events[0].workspaceId !== "workspace-1" ||
  parsed.events[0].source !== "ai_plan"
) {
  throw new Error("Valid study plan events should be normalized.");
}

const blankOptionals = parseStudyPlanResponse(
  JSON.stringify({
    summary: "A compact plan",
    events: [
      {
        title: "Review algorithms",
        notes: "",
        eventType: "study_session",
        dueDate: "2026-12-01",
        dueTime: "",
        workspaceId: "",
        quizId: "",
      },
    ],
  }),
  { workspaceIds: ["workspace-1"] }
);
if (
  blankOptionals.events[0].notes !== null ||
  blankOptionals.events[0].dueTime !== null ||
  blankOptionals.events[0].workspaceId !== null ||
  blankOptionals.events[0].quizId !== null
) {
  throw new Error("Empty optional plan fields should normalize to null.");
}

for (const raw of [
  '{"summary":"Bad date","events":[{"title":"Test","eventType":"exam","dueDate":"2026-02-30"}]}',
  '{"summary":"Unknown workspace","events":[{"title":"Test","eventType":"exam","dueDate":"2026-12-01","workspaceId":"unknown"}]}',
]) {
  let rejected = false;
  try {
    parseStudyPlanResponse(raw, { workspaceIds: ["workspace-1"] });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Invalid study plan input should be rejected.");
}

let storedAiSettings: string | null = null;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) =>
      key === "noesis.ai.settings.v1" ? storedAiSettings : null,
    setItem: () => {},
  },
});

async function verifyGeneratedPlans(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const plannedEvent = {
    title: "Practice graph traversal",
    notes: "",
    eventType: "study_session",
    dueDate: "2026-12-01",
    dueTime: "",
    workspaceId: "workspace-1",
    quizId: "",
  };
  const workspaces = [
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `workspace-${index + 2}`,
      title: `General course ${index + 2}`,
      unmasteredCount: index,
    })),
    { id: "workspace-1", title: "Algorithms", unmasteredCount: 6 },
  ];

  try {
    storedAiSettings = JSON.stringify({
      provider: "openai-compatible",
      openAiPreset: "ollama",
      localBaseUrl: "http://localhost:11434/v1",
      localModel: "qwen2.5",
      localContextWindowTokens: 4096,
      localMaxOutputTokens: 1200,
    });
    const localBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      localBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const event = localBodies.length === 1
        ? { ...plannedEvent, dueDate: "2026-02-30" }
        : plannedEvent;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Practice algorithms this week.",
                  events: [event],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const localPlan = await generateCalendarStudyPlan({
      request: "Plan graph traversal practice in Algorithms",
      today: "2026-11-27",
      workspaces,
    });
    const localMessages = localBodies[0].messages as Array<{
      role: string;
      content: string;
    }>;
    if (
      localPlan.events[0].workspaceId !== "workspace-1" ||
      localPlan.events[0].dueTime !== null ||
      localPlan.events[0].source !== "ai_plan" ||
      localBodies.length !== 2 ||
      localBodies[0].max_tokens !== 1200 ||
      !localMessages.some(
        (message) =>
          message.role === "user" &&
          message.content.includes("workspace-1") &&
          !message.content.includes("workspace-21")
      ) ||
      !(localBodies[1].messages as Array<{ role: string; content: string }>).some(
        (message) =>
          message.role === "user" &&
          message.content.includes("failed validation")
      )
    ) {
      throw new Error(
        "Local calendar plans should use relevant context, fit the output budget, and retry invalid dates."
      );
    }

    storedAiSettings = JSON.stringify({
      provider: "gemini",
      apiKey: "test-key",
      fastModel: "gemini-4-hydrogen",
      synthesisModel: "gemini-3.5-flash-lite",
    });
    let cloudBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      cloudBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: "Prepare for the exam over the next week.",
                      events: [plannedEvent],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const cloudPlan = await generateCalendarStudyPlan({
      request: "Prepare for the algorithms exam",
      today: "2026-11-27",
      workspaces,
    });
    const cloudConfig = cloudBody?.generationConfig as
      | Record<string, unknown>
      | undefined;
    const cloudSchema = JSON.stringify(cloudConfig?.responseSchema);
    if (
      cloudPlan.events.length !== 1 ||
      cloudPlan.events[0].source !== "ai_plan" ||
      cloudConfig?.maxOutputTokens !== 4096 ||
      !cloudConfig?.responseSchema ||
      cloudSchema.includes('"enum":[""]')
    ) {
      throw new Error(
        "Cloud calendar plans should use structured output without unsupported empty enums."
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await verifyGeneratedPlans();

console.log("✓ Calendar plan schema validation passed.");
