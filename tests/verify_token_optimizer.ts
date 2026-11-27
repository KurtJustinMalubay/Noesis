import {
  buildTutorPayload,
  compressTutorHistory,
  estimateTokens,
  extractRelevantLessonContext,
  fitRequestToProviderBudget,
  getProviderBudget,
  minifyContextText,
} from "../src/ai/tokenOptimizer.ts";
import { selectTopVaultChunks } from "../src/vault/search.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const lesson = [
  "# Intro",
  "Long preamble that does not answer the question.",
  "## Section 1: Alphabet",
  "A unique irrelevant passage about the alphabet.",
  "## Section 2: Automata",
  "A unique passage about deterministic states.",
  "## Section 3: Transition Function",
  "The transition function maps $q$ and $a$ to $\\delta(q, a)$.",
  "Key Takeaways",
  "- Each transition consumes one input symbol.",
].join("\n\n");

const extracted = extractRelevantLessonContext(
  lesson,
  "How does the transition function map q and a?",
  300,
  { lessonTitle: "Finite Automata" }
);
assert(
  extracted.includes("transition function maps") &&
    !extracted.includes("unique irrelevant passage about the alphabet"),
  "lesson retrieval should favor the section most relevant to the query"
);
assert(
  estimateTokens(extracted) <= 300,
  "extracted lesson context should respect its token budget"
);

const minified = minifyContextText(
  "Keep  $\\Sigma^*$ intact.   \n\n\n<!-- remove -->\n\n```c\nint *pt;   \n\n```"
);
assert(
  minified.includes("$\\Sigma^*$") &&
    minified.includes("int *pt;   ") &&
    !minified.includes("<!--"),
  "prompt minification should preserve math and code while removing comments and blank lines"
);

const localPayload = buildTutorPayload({
  provider: "openai-compatible",
  userMessage: "Explain Section 3 transitions.",
  activeNodeTitle: "Finite Automata",
  lessonTitle: "Finite Automata",
  lessonSummary: "Transition systems for regular languages.",
  lessonLayer: 2,
  lessonMarkdown: `${lesson}\n${"Unrelated detail that is not needed for this query. ".repeat(500)}`,
  vaultChunks: [
    {
      file_name: "Automata.md",
      heading: "Transitions",
      content: "A transition consumes one input symbol.",
    },
  ],
  history: Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `Study message ${index}.`,
  })),
});
assert(
  localPayload.totalTokens <= getProviderBudget("openai-compatible").total &&
    localPayload.savedPercent > 0,
  "Tutor payload telemetry should report bounded, reduced context"
);
const assistantPayload = buildTutorPayload({
  provider: "openai-compatible",
  interactionStyle: "assistant",
  userMessage: "Give me a direct explanation.",
  vaultChunks: [],
  history: [{ role: "assistant", content: "Earlier answer." }],
});
assert(
  assistantPayload.systemInstruction.includes("without forcing a tutoring") &&
    assistantPayload.userPrompt.includes("Assistant: Earlier answer") &&
    !assistantPayload.userPrompt.includes("Tutor: Earlier answer"),
  "AI assistant mode should use direct-answer guidance and assistant history labels"
);
const oversizedPayload = buildTutorPayload({
  provider: "openai-compatible",
  userMessage: "Question ".repeat(800),
  lessonTitle: "Long lesson",
  lessonSummary: "Summary ".repeat(80),
  lessonLayer: 1,
  lessonMarkdown: `${lesson}\n${"Lesson paragraph. ".repeat(2000)}`,
  vaultChunks: Array.from({ length: 5 }, (_, index) => ({
    file_name: `source-${index}.md`,
    heading: `Section ${index}`,
    content: "Vault paragraph. ".repeat(800),
  })),
  history: Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: "Conversation paragraph. ".repeat(300),
  })),
});
assert(
  oversizedPayload.totalTokens <= getProviderBudget("openai-compatible").total,
  "even oversized tutor context should respect the provider token ceiling"
);
assert(
  compressTutorHistory(
    Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `Message ${index}`,
    })),
    "Earlier summary"
  ).recentMessages.length === 6,
  "rolling history should preserve only the latest six messages verbatim"
);
const boundedPrompt = fitRequestToProviderBudget(
  "Be concise.",
  `${"Long context paragraph. ".repeat(1000)}\n\nStudent question: explain this`,
  "openai-compatible"
);
assert(
  estimateTokens(boundedPrompt.systemInstruction) +
    estimateTokens(boundedPrompt.userPrompt) <= 1400 &&
    boundedPrompt.userPrompt.includes("Student question:"),
  "provider request fitting should enforce the local ceiling while preserving the query"
);
const customLocalBudget = getProviderBudget(
  "openai-compatible",
  8192,
  2048
);
assert(
  customLocalBudget.total === 6016 &&
    customLocalBudget.lesson > getProviderBudget("openai-compatible").lesson,
  "local Tutor context allocation should scale with configured context and output limits"
);
const customBoundedPrompt = fitRequestToProviderBudget(
  "Be concise.",
  `${"Long context paragraph. ".repeat(6000)}\n\nStudent question: explain this`,
  "openai-compatible",
  undefined,
  customLocalBudget.total
);
assert(
  estimateTokens(customBoundedPrompt.systemInstruction) +
    estimateTokens(customBoundedPrompt.userPrompt) <= customLocalBudget.total &&
    customBoundedPrompt.userPrompt.includes("Student question:"),
  "request fitting should honor a customized local input budget"
);

const chunks = [
  {
    file_name: "a.md",
    heading: null,
    content: "Transition function consumes an input symbol.",
    rank: -1,
  },
  {
    file_name: "b.md",
    heading: null,
    content: " transition   function consumes an input symbol. ",
    rank: -0.9,
  },
  {
    file_name: "c.md",
    heading: "Transition",
    content: "δ maps a state and symbol to a new state.",
    rank: -0.7,
  },
];
const topChunks = selectTopVaultChunks(chunks, "transition function", 2);
assert(
  topChunks.length === 2 &&
    topChunks[0].file_name === "a.md" &&
    topChunks.some((chunk) => chunk.file_name === "c.md"),
  "vault ranking should deduplicate overlapping chunks and return top-K results"
);

const dashboardTutorPayload = buildTutorPayload({
  provider: "gemini",
  userMessage: "What should I study next?",
  dashboardContext:
    "Study Dashboard Overview:\n- Concepts: 4/10 mastered (40%), 2 in progress\n- Flashcards: 5 due now",
  vaultChunks: [],
  history: [],
});
assert(
  dashboardTutorPayload.userPrompt.includes("Study Dashboard Overview:") &&
    dashboardTutorPayload.userPrompt.includes("5 due now"),
  "tutor payload should include dashboard context when no lesson is active"
);

console.log("✓ Token optimizer and bounded vault ranking tests passed!");
