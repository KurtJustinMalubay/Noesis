import {
  generateNodeQuiz,
  gradeSubjectiveBatch,
  parseQuizPayload,
} from "../src/ai/quizService.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function run(): Promise<void> {
  const parsed = parseQuizPayload(
    '```json\n[{"id":"q1","type":"mcq","prompt":"Which is $2 + 2$?","options":["3","4","5","6"],"answerIndex":1,"explanation":"Four."},{"id":"bad","type":"mcq","prompt":"bad","options":["A"],"answerIndex":0,"explanation":"invalid"}]\n```',
    "node-1"
  );
  assert(
    parsed.length === 1 &&
      parsed[0].prompt === "Which is $2 + 2$?" &&
      parsed[0].answerIndex === 1 &&
      parsed[0].sourceNodeId === "node-1",
    "fenced root arrays should coerce into quiz questions and discard malformed entries"
  );

  let invalidPayloadThrew = false;
  try {
    parseQuizPayload('{"questions":[]}', "node-1");
  } catch (error) {
    invalidPayloadThrew =
      error instanceof Error && error.message.includes("no valid questions");
  }
  assert(invalidPayloadThrew, "empty valid output should request a retry");

  let requestCount = 0;
  let requestBody: Record<string, unknown> | null = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) =>
        key === "noesis.ai.settings.v1"
          ? JSON.stringify({
              provider: "gemini",
              apiKey: "test-key",
              fastModel: "gemini-4-hydrogen",
              synthesisModel: "gemini-3.5-flash-lite",
            })
          : null,
      setItem: () => {},
    },
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestCount += 1;
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    results: [
                      {
                        id: "open-1",
                        score: 0.9,
                        passed: true,
                        feedback: "Clear explanation.",
                        optimalSolution: "Reference answer.",
                      },
                      {
                        id: "code-1",
                        score: 0.8,
                        passed: true,
                        feedback: "Correct approach.",
                        optimalSolution: "Reference implementation.",
                      },
                    ],
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

  const results = await gradeSubjectiveBatch([
    {
      id: "open-1",
      type: "open_ended",
      prompt: "Explain the invariant.",
      answer: "It remains true throughout the loop.",
      rubric: "Names and explains the invariant.",
      referenceAnswer: "The loop preserves the invariant.",
    },
    {
      id: "code-1",
      type: "coding",
      prompt: "Implement a binary search.",
      answer: "function search() {}",
      rubric: "Correct logarithmic search.",
      referenceAnswer: "A standard binary search.",
      language: "JavaScript",
    },
  ]);
  const generationConfig = requestBody?.generationConfig as
    | Record<string, unknown>
    | undefined;
  const schema = generationConfig?.responseSchema as
    | Record<string, unknown>
    | undefined;
  assert(
    requestCount === 1 && results.length === 2,
    "all subjective responses should be graded in one network request"
  );
  assert(
    generationConfig?.responseMimeType === "application/json" &&
      schema?.type === "OBJECT",
    "batch grading should enforce a root JSON object schema"
  );

  const generatedQuestions = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `generated-${index + 1}`,
      type: "mcq",
      prompt: `Question ${index + 1}?`,
      options: ["Alpha", "Beta", "Gamma", "Delta"],
      answerIndex: index % 4,
      explanation: "Grounded in the lesson.",
    }));
  let generationCalls = 0;
  let retryPrompt = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    generationCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      contents?: Array<{ parts?: Array<{ text?: string }> }>;
    };
    retryPrompt = body.contents?.[0]?.parts?.[0]?.text ?? retryPrompt;
    const questions = generatedQuestions(generationCalls === 1 ? 2 : 3);
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ questions }) }] } },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  const generated = await generateNodeQuiz(
    {
      id: "node-1",
      workspace_id: "workspace-1",
      title: "Graph traversal",
      summary_hint: "Understand breadth-first traversal.",
      status: "unlocked",
      mastery_score: 0,
      in_degree_unmastered: 0,
      layer_index: 0,
      pos_x: 0,
      pos_y: 0,
      is_hydrated: 1,
      lesson_markdown: "## Key Takeaways\n- Visit each vertex once.",
      mermaid_diagram: null,
      source_citations: null,
      updated_at: 0,
    },
    { formats: ["mcq"], count: 3, language: "auto" }
  );
  assert(
    generated.length === 3 &&
      generationCalls === 2 &&
      retryPrompt.includes("previous response was invalid"),
    "quiz generation should regenerate once when the first structured response fails count validation"
  );

  console.log("✓ Multi-modal quiz parsing and batch grading tests passed!");
}

run().catch((error) => {
  console.error("Quiz tests failed:", error);
  process.exitCode = 1;
});
