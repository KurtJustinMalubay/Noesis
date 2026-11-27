import {
  getDifficultyQuotas,
  getLocalQuizBatches,
  generateNodeQuiz,
  loadQuizPreferences,
  gradeSubjectiveBatch,
  parseQuizPayload,
} from "../src/ai/quizService.ts";
import type { GraphNode } from "../src/types/domain.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function run(): Promise<void> {
  const cancelledNode: GraphNode = {
    id: "cancelled-node",
    workspace_id: "workspace",
    title: "Test topic",
    summary_hint: "A test topic.",
    status: "unlocked",
    mastery_score: 0,
    in_degree_unmastered: 0,
    layer_index: 0,
    pos_x: 0,
    pos_y: 0,
    is_hydrated: 1,
    lesson_markdown: "A test lesson.",
    mermaid_diagram: null,
    source_citations: null,
    updated_at: 0,
  };
  const cancelledController = new AbortController();
  cancelledController.abort();
  let generationAborted = false;
  try {
    await generateNodeQuiz(
      cancelledNode,
      { formats: ["coding"], count: 3, language: "JavaScript" },
      undefined,
      cancelledController.signal
    );
  } catch (error) {
    generationAborted =
      error instanceof DOMException && error.name === "AbortError";
  }
  assert(
    generationAborted,
    "cancelled quiz generation should stop before making a model request"
  );

  const parsed = parseQuizPayload(
    '```json\n[{"id":"q1","type":"mcq","prompt":"Which is $2 + 2$?","options":["3","4","5","6"],"answerIndex":1,"explanation":"Four."},{"id":"bad","type":"mcq","prompt":"bad","options":["A"],"answerIndex":0,"explanation":"invalid"}]\n```',
    "node-1"
  );
  assert(
    parsed.length === 2 &&
      parsed[0].prompt === "Which is $2 + 2$?" &&
      parsed[0].answerIndex === 1 &&
      parsed[0].sourceNodeId === "node-1" &&
      parsed[1].options?.length === 4 &&
      parsed[1].answerIndex === 0,
    "fenced root arrays should coerce into safe quiz questions with four MCQ options"
  );

  const normalizedFallbacks = parseQuizPayload(
    '{"questions":[{"type":"coding","prompt":"Return two lines.","starterCode":"first\\\\nsecond","sampleCases":{"input":1,"output":2},"hints":["Check each line"]},{"type":"open_ended","expectedKeyPoints":["Name the invariant"],"sampleAnswer":"It stays true."}]}',
    "node-fallbacks"
  );
  assert(
    normalizedFallbacks[0].starterCode?.includes("\n") &&
      normalizedFallbacks[0].testCases?.[0].includes('"input":1') &&
      normalizedFallbacks[0].hints?.[0] === "Check each line" &&
      normalizedFallbacks[1].prompt.length > 0 &&
      normalizedFallbacks[1].rubric?.includes("Name the invariant") &&
      normalizedFallbacks[1].referenceAnswer === "It stays true.",
    "coding and open-ended questions should receive safe field defaults and normalized sample data"
  );

  const tolerantParsed = parseQuizPayload(
    JSON.stringify({
      questions: [
        {
          type: "multiple-choice",
          q: "Which traversal uses a queue?",
          choices: { A: "BFS", B: "DFS", C: "Dijkstra", D: "Prim" },
          answer: "A",
        },
        {
          type: "open-ended",
          stem: "Explain why breadth-first search finds shortest paths.",
          expectedAnswer: "It explores vertices in nondecreasing distance.",
        },
        {
          type: "coding",
          prompt: "Write a queue-based BFS.",
          codeTemplate: "",
          examples: [{ input: "start=0", output: "[0]" }],
        },
      ],
    }),
    "node-compat"
  );
  assert(
    tolerantParsed.length === 3 &&
      tolerantParsed[0].id === "node-compat-question-1" &&
      tolerantParsed[0].answerIndex === 0 &&
      tolerantParsed[0].explanation.length > 0 &&
      tolerantParsed[1].referenceAnswer?.startsWith("It explores") &&
      tolerantParsed[2].language === "auto" &&
      tolerantParsed[2].testCases?.[0].includes('"input":"start=0"'),
    "quiz normalization should accept common provider field aliases and fill safe metadata defaults"
  );

  let invalidPayloadThrew = false;
  try {
    parseQuizPayload('{"questions":[]}', "node-1");
  } catch (error) {
    invalidPayloadThrew =
      error instanceof Error && error.message.includes("no valid questions");
  }
  assert(invalidPayloadThrew, "empty valid output should request a retry");
  const progressiveTwelve = getDifficultyQuotas(12, "progressive");
  const balancedTwelve = getDifficultyQuotas(12, "balanced");
  assert(
    progressiveTwelve.easy + progressiveTwelve.medium + progressiveTwelve.hard === 12 &&
      progressiveTwelve.easy >= progressiveTwelve.hard &&
      balancedTwelve.easy === 4 &&
      balancedTwelve.medium === 4 &&
      balancedTwelve.hard === 4,
    "hybrid difficulty quotas should cover all twelve items and balance each difficulty"
  );
  const progressiveTen = getDifficultyQuotas(10, "progressive");
  assert(
    progressiveTen.easy === 3 &&
      progressiveTen.medium === 4 &&
      progressiveTen.hard === 3,
    "progressive hybrid mode should distribute ten questions across easy, medium, and hard"
  );
  const compactLocalBatches = getLocalQuizBatches(
    new Map([["mcq", 10]]),
    1200
  );
  assert(
    compactLocalBatches
      .map((batch) => batch.get("mcq"))
      .join(",") === "4,4,2",
    "local quiz batches should shrink to fit the configured response token budget"
  );

  let requestCount = 0;
  let requestBody: Record<string, unknown> | null = null;
  let storedAiSettings = JSON.stringify({
    provider: "gemini",
    apiKey: "test-key",
    fastModel: "gemini-4-hydrogen",
    synthesisModel: "gemini-3.5-flash-lite",
  });
  let storedQuizPreferences: string | null = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) =>
        key === "noesis.ai.settings.v1"
          ? storedAiSettings
          : key === "noesis.quiz-preferences.v1"
            ? storedQuizPreferences
            : null,
      setItem: () => {},
    },
  });
  storedQuizPreferences = JSON.stringify({
    formats: ["mcq", "open_ended", "coding"],
    count: 12,
    difficultyMode: "balanced",
  });
  const maxQuizPreferences = loadQuizPreferences();
  assert(
    maxQuizPreferences.count === 12 &&
      maxQuizPreferences.difficultyMode === "balanced",
    "saved quiz configuration should accept the supported 12-question maximum and hybrid mode"
  );
  storedQuizPreferences = JSON.stringify({
    formats: ["mcq"],
    count: 13,
    difficultyMode: "balanced",
  });
  assert(
    loadQuizPreferences().count <= 12,
    "persisted quiz preferences must not exceed the 12-question maximum"
  );
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

  const firstBatch = [
    {
      id: "generated-mcq",
      type: "mcq",
      prompt: "Which traversal uses a queue?",
      options: ["BFS", "DFS", "Dijkstra", "Prim"],
      answerIndex: 0,
      explanation: "Breadth-first traversal uses a queue.",
    },
    {
      id: "generated-open",
      type: "open_ended",
      prompt: "Why does BFS find shortest paths in an unweighted graph?",
      rubric: "Explains exploration by increasing distance.",
      referenceAnswer: "BFS visits vertices in nondecreasing edge distance.",
      explanation: "The queue processes each frontier in order.",
    },
  ];
  const codingQuestion = {
    id: "generated-code",
    type: "coding",
    prompt: "Implement a queue-based graph traversal.",
    language: "C++",
    starterCode: "void bfs(int start) {}",
    testCases: ["start=0; expect visited=[0]"],
    rubric: "Visits reachable nodes using a queue.",
    referenceAnswer: "Initialize a queue with the start node and visit neighbors.",
    explanation: "A queue processes nodes by distance from the start.",
  };
  const quizNode = {
    id: "node-1",
    workspace_id: "workspace-1",
    title: "Graph traversal",
    summary_hint: "Understand breadth-first traversal.",
    status: "unlocked" as const,
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
  };
  let generationCalls = 0;
  const generationPrompts: string[] = [];
  const generationBudgets: number[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    generationCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      contents?: Array<{ parts?: Array<{ text?: string }> }>;
      generationConfig?: {
        maxOutputTokens?: number;
        responseMimeType?: string;
        responseSchema?: {
          type?: string;
          properties?: {
            questions?: { items?: { required?: string[] } };
          };
        };
      };
    };
    generationPrompts.push(body.contents?.[0]?.parts?.[0]?.text ?? "");
    generationBudgets.push(body.generationConfig?.maxOutputTokens ?? 0);
    if (generationCalls === 1) {
      const required =
        body.generationConfig?.responseSchema?.properties?.questions?.items
          ?.required ?? [];
      assert(
        body.generationConfig?.responseMimeType === "application/json" &&
          body.generationConfig.responseSchema?.type === "OBJECT" &&
          required.includes("options") &&
          required.includes("answerIndex") &&
          required.includes("referenceAnswer") &&
          required.includes("starterCode") &&
          !required.includes("difficulty") &&
          !required.includes("id"),
        "structured quiz schema should require only question fields and leave difficulty assignment to the app"
      );
    }
    const questions = generationCalls === 1 ? firstBatch : [codingQuestion];
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify({ questions }) }] } },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  const generated = await generateNodeQuiz(quizNode, {
    formats: ["mcq", "open_ended", "coding"],
    count: 3,
    language: "C++",
    difficultyMode: "progressive",
  });
  assert(
    generated.length === 3 &&
      generationCalls === 2 &&
      generated.some((question) => question.type === "coding") &&
      generated.some((question) => question.type === "open_ended") &&
      generated.map((question) => question.difficulty).join(",") ===
        "easy,medium,hard" &&
      generationPrompts[0].includes(
        "Required questions: 1 mcq, 1 open_ended, 1 coding"
      ) &&
      generationPrompts[1].includes("Missing question counts: 1 coding") &&
      generationBudgets[0] >= 1300,
    "quiz generation should use a concise format request, then merge valid missing questions"
  );

  let tolerantGenerationCalls = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    tolerantGenerationCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      generationConfig?: {
        responseSchema?: {
          properties?: {
            questions?: { items?: { required?: string[] } };
          };
        };
      };
    };
    const required =
      body.generationConfig?.responseSchema?.properties?.questions?.items
        ?.required ?? [];
    assert(required.includes("explanation"), "all schema fields should be explicit");
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    questions: [
                      {
                        type: "multiple-choice",
                        q: "Which traversal uses a queue?",
                        choices: ["BFS", "DFS", "Dijkstra", "Prim"],
                        answer: "A",
                      },
                      {
                        type: "open-ended",
                        stem: "Explain BFS shortest paths.",
                        expectedAnswer: "BFS explores by increasing distance.",
                      },
                      {
                        type: "coding",
                        prompt: "Write a queue-based BFS.",
                        programmingLanguage: "C++",
                        codeTemplate: "",
                        testCases: [],
                        solution: "Use a queue and mark visited nodes.",
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
  const providerVariantQuestions = await generateNodeQuiz(quizNode, {
    formats: ["mcq", "open_ended", "coding"],
    count: 3,
    language: "C++",
  });
  assert(
    providerVariantQuestions.length === 3 &&
      tolerantGenerationCalls === 1 &&
      providerVariantQuestions[0].answerIndex === 0 &&
      providerVariantQuestions.every((question) => question.explanation),
    "quiz generation should accept common provider field variants and synthesize omitted non-answer metadata without retrying"
  );

  let rateLimitCalls = 0;
  let rateLimitSchemaKeys: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    rateLimitCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      generationConfig?: {
        responseSchema?: {
          properties?: {
            questions?: {
              items?: { properties?: Record<string, unknown> };
            };
          };
        };
      };
    };
    rateLimitSchemaKeys = Object.keys(
      body.generationConfig?.responseSchema?.properties?.questions?.items
        ?.properties ?? {}
    );
    return new Response(
      JSON.stringify({ error: { message: "Quota exceeded" } }),
      { status: 429, statusText: "Too Many Requests" }
    );
  }) as typeof fetch;
  let rateLimitMessage = "";
  try {
    await generateNodeQuiz(quizNode, {
      formats: ["mcq"],
      count: 3,
      language: "auto",
    });
  } catch (error) {
    rateLimitMessage = error instanceof Error ? error.message : String(error);
  }
  assert(
    rateLimitCalls === 1 &&
      rateLimitSchemaKeys.sort().join(",") ===
        "answerIndex,explanation,options,prompt,type" &&
      rateLimitMessage.includes("rate limit") &&
      rateLimitMessage.includes("try fewer questions"),
    "multiple-choice quizzes should use a minimal schema and stop after one rate-limited request with free-tier guidance"
  );

  storedAiSettings = JSON.stringify({
    provider: "openai-compatible",
    openAiPreset: "groq",
    openAiApiKeys: { groq: "test-key" },
    openAiFastModel: "llama-3.1-8b-instant",
    localBaseUrl: "https://api.groq.com/openai/v1",
  });
  let hostedProviderCalls = 0;
  let hostedProviderPrompt = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    hostedProviderCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages?: Array<{ role: string; content: string }>;
    };
    hostedProviderPrompt =
      body.messages?.find((message) => message.role === "user")?.content ?? "";
    const questions = Array.from({ length: 12 }, (_, index) => ({
      id: `hosted-mcq-${index}`,
      type: "mcq",
      prompt: `Hosted-provider question ${index + 1}`,
      options: ["A", "B", "C", "D"],
      answerIndex: index % 4,
      explanation: "This tests the concept.",
    }));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions }) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  const hostedProviderQuestions = await generateNodeQuiz(quizNode, {
    formats: ["mcq"],
    count: 12,
    language: "auto",
  });
  assert(
    hostedProviderQuestions.length === 12 &&
      hostedProviderCalls === 1 &&
      !hostedProviderPrompt.includes("Batch 1 of"),
    "hosted OpenAI-compatible providers should generate a quiz in one request instead of local-model batches"
  );

  storedAiSettings = JSON.stringify({
    provider: "openai-compatible",
    localBaseUrl: "http://127.0.0.1:11434/v1",
    localModel: "small-local-model",
  });
  let localCodingCalls = 0;
  const localCodingResponseFormats: unknown[] = [];
  const codingBatchSizes: number[] = [];
  const codingBatchPrompts: string[] = [];
  const codingProgress: Array<{ completed: number; total: number }> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    localCodingCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages?: Array<{ role: string; content: string }>;
      response_format?: unknown;
    };
    localCodingResponseFormats.push(body.response_format);
    const prompt = body.messages?.find((message) => message.role === "user")?.content ?? "";
    codingBatchPrompts.push(prompt);
    const requested = Number(
      prompt.match(/generate exactly (\d+) question\(s\)/)?.[1] ?? 0
    );
    codingBatchSizes.push(requested);
    const questions = Array.from({ length: requested }, (_, index) => ({
      id: `local-code-${localCodingCalls}-${index}`,
      type: "coding",
      prompt: `Local coding question ${localCodingCalls}-${index}`,
      language: "C++",
      starterCode: "",
      testCases: ["input=1; output=1"],
      rubric: "Correct implementation.",
      referenceAnswer: "Use the requested algorithm.",
      explanation: "This exercises the target concept.",
    }));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions }) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  const codingProgressResult = await generateNodeQuiz(
    quizNode,
    { formats: ["coding"], count: 5, language: "C++" },
    (progress) => codingProgress.push(progress)
  );
  assert(
    codingProgressResult.length === 5 &&
      localCodingCalls === 3 &&
      codingBatchSizes.join(",") === "2,2,1" &&
      codingBatchPrompts[1].includes("Local coding question 1-0") &&
      codingProgress[codingProgress.length - 1].completed === 3,
    "local coding quizzes should use batches of at most two and report incremental progress"
  );
  assert(
    localCodingResponseFormats.length === 3 &&
      localCodingResponseFormats.every((value) => {
        if (!value || typeof value !== "object") return false;
        const format = value as {
          type?: unknown;
          json_schema?: {
            strict?: unknown;
            schema?: {
              type?: unknown;
              additionalProperties?: unknown;
              required?: unknown;
            };
          };
        };
        return (
          format.type === "json_schema" &&
          format.json_schema?.strict === true &&
          format.json_schema.schema?.type === "object" &&
          format.json_schema.schema?.additionalProperties === false &&
          Array.isArray(format.json_schema.schema?.required) &&
          format.json_schema.schema.required.includes("questions")
        );
      }),
    "each local quiz batch should request a strict JSON object with a required questions array"
  );

  let localMcqCalls = 0;
  const mcqBatchSizes: number[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    localMcqCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages?: Array<{ role: string; content: string }>;
    };
    const prompt = body.messages?.find((message) => message.role === "user")?.content ?? "";
    const requested = Number(
      prompt.match(/generate exactly (\d+) question\(s\)/)?.[1] ?? 0
    );
    mcqBatchSizes.push(requested);
    const questions = Array.from({ length: requested }, (_, index) => ({
      id: `local-mcq-${localMcqCalls}-${index}`,
      type: "mcq",
      prompt: `Local multiple-choice question ${localMcqCalls}-${index}`,
      options: ["A", "B", "C", "D"],
      answerIndex: 0,
      explanation: "A is correct.",
    }));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions }) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  const localMcqResult = await generateNodeQuiz(quizNode, {
    formats: ["mcq"],
    count: 12,
    language: "auto",
  });
  assert(
    localMcqResult.length === 12 &&
      localMcqCalls === 3 &&
      mcqBatchSizes.join(",") === "5,5,2" &&
      mcqBatchSizes.every((size) => size <= 5),
    "local multiple-choice quizzes should split twelve questions into batches of at most five"
  );

  console.log("✓ Multi-modal quiz parsing and batch grading tests passed!");
}

run().catch((error) => {
  console.error("Quiz tests failed:", error);
  process.exitCode = 1;
});
