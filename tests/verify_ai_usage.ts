import {
  getAiUsageSummary,
  recordAiUsage,
} from "../src/ai/usage.ts";
import { generateGeminiText } from "../src/ai/geminiClient.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

let storedValue: string | null = null;
let storedAiSettings = JSON.stringify({
  provider: "gemini",
  apiKey: "test-key",
  fastModel: "gemini-test",
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) =>
      key === "noesis.ai-usage.v1"
        ? storedValue
        : key === "noesis.ai.settings.v1"
          ? storedAiSettings
          : null,
    setItem: (key: string, value: string) => {
      if (key === "noesis.ai-usage.v1") storedValue = value;
    },
  },
});

const now = Date.now();
const currentMonthStart = new Date(
  new Date(now).getFullYear(),
  new Date(now).getMonth(),
  1,
  12
).getTime();
const previousMonth = new Date(
  new Date(now).getFullYear(),
  new Date(now).getMonth() - 1,
  15,
  12
).getTime();

recordAiUsage(
  { inputTokens: 120, outputTokens: 45, isEstimated: false },
  currentMonthStart
);
recordAiUsage(
  { inputTokens: 80, outputTokens: 30, isEstimated: true },
  previousMonth
);

const summary = getAiUsageSummary(now);
assert(
  summary.thisMonth.requestCount === 1 &&
    summary.thisMonth.inputTokens === 120 &&
    summary.thisMonth.outputTokens === 45 &&
    summary.thisMonth.estimatedRequestCount === 0,
  "monthly dashboard totals should include only current-month usage"
);
assert(
  summary.allTime.requestCount === 2 &&
    summary.allTime.estimatedRequestCount === 1 &&
    storedValue !== null,
  "usage totals should persist locally and distinguish estimated requests"
);

async function verifyProviderUsage(): Promise<void> {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "Gemini response" }] } },
        ],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 12,
          totalTokenCount: 62,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;
  await generateGeminiText({
    tier: "fast",
    systemInstruction: "Answer briefly.",
    userPrompt: "Question",
  });

  storedAiSettings = JSON.stringify({
    provider: "openai-compatible",
    openAiPreset: "groq",
    openAiApiKeys: { groq: "test-key" },
    openAiFastModel: "hosted-test",
    localBaseUrl: "https://api.groq.com/openai/v1",
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "Hosted response" } }],
        usage: { prompt_tokens: 70, completion_tokens: 18, total_tokens: 88 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;
  await generateGeminiText({
    tier: "fast",
    systemInstruction: "Answer briefly.",
    userPrompt: "Question",
  });

  storedAiSettings = JSON.stringify({
    provider: "openai-compatible",
    openAiPreset: "ollama",
    openAiFastModel: "local-test",
    localBaseUrl: "http://localhost:11434/v1",
  });
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "Local response" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;
  await generateGeminiText({
    tier: "fast",
    systemInstruction: "Answer briefly.",
    userPrompt: "Question",
  });

  const updated = getAiUsageSummary(Date.now());
  assert(
    updated.thisMonth.requestCount === 4 &&
      updated.thisMonth.inputTokens === 247 &&
      updated.thisMonth.outputTokens === 79 &&
      updated.thisMonth.estimatedRequestCount === 1,
    "Gemini, hosted OpenAI-compatible, and local models should all contribute usage with estimates when metadata is absent"
  );
  assert(
    updated.allTime.requestCount === 5 &&
      updated.allTime.estimatedRequestCount === 2,
    "provider usage should aggregate into persistent all-time totals"
  );
}

verifyProviderUsage()
  .then(() => console.log("✓ Local AI usage aggregation tests passed!"))
  .catch((error) => {
    console.error("AI usage tests failed:", error);
    process.exitCode = 1;
  });
