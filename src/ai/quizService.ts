import {
  generateGeminiJson,
  getLocalOutputTokenBudget,
  isRateLimitApiError,
  isLocalAiEndpoint,
  parseGeminiJson,
} from "./geminiClient.ts";
import { loadAiSettings } from "./keyStore.ts";
import { minifyContextText } from "./tokenOptimizer.ts";
import { normalizeQuizQuestions } from "./diagnosticQuiz.ts";
import type {
  GraphNode,
  QuizGenerationConfig,
  QuizDifficulty,
  QuizDifficultyMode,
  QuizGradingResult,
  QuizQuestion,
  QuizQuestionType,
} from "../types/domain";

const QUIZ_PREFERENCES_KEY = "noesis.quiz-preferences.v1";

export const DEFAULT_QUIZ_CONFIG: QuizGenerationConfig = {
  formats: ["mcq"],
  count: 5,
  language: "auto",
  difficultyMode: "medium",
};

function getQuestionSchema(
  formats: Iterable<QuizQuestionType>
): Record<string, unknown> {
  const selectedFormats = [...new Set(formats)];
  const properties: Record<string, unknown> = {
    type: { type: "STRING", enum: selectedFormats },
    prompt: { type: "STRING" },
    explanation: { type: "STRING" },
  };
  const required = ["type", "prompt", "explanation"];

  if (selectedFormats.includes("mcq")) {
    properties.options = { type: "ARRAY", items: { type: "STRING" } };
    properties.answerIndex = { type: "INTEGER" };
    required.push("options", "answerIndex");
  }
  if (selectedFormats.includes("open_ended")) {
    properties.rubric = { type: "STRING" };
    properties.referenceAnswer = { type: "STRING" };
    required.push("rubric", "referenceAnswer");
  }
  if (selectedFormats.includes("coding")) {
    properties.rubric = { type: "STRING" };
    properties.referenceAnswer = { type: "STRING" };
    properties.language = { type: "STRING" };
    properties.starterCode = { type: "STRING" };
    properties.testCases = { type: "ARRAY", items: { type: "STRING" } };
    properties.hints = { type: "ARRAY", items: { type: "STRING" } };
    required.push(
      "rubric",
      "referenceAnswer",
      "language",
      "starterCode",
      "testCases",
      "hints"
    );
  }

  return {
    type: "OBJECT",
    properties: {
      questions: {
        type: "ARRAY",
        items: { type: "OBJECT", properties, required },
      },
    },
    required: ["questions"],
  };
}

export function loadQuizPreferences(): QuizGenerationConfig {
  try {
    const raw = localStorage.getItem(QUIZ_PREFERENCES_KEY);
    if (!raw) return DEFAULT_QUIZ_CONFIG;
    const value = JSON.parse(raw) as Partial<QuizGenerationConfig>;
    const formats = Array.isArray(value.formats)
      ? value.formats.filter(
          (format): format is QuizQuestionType =>
            format === "mcq" ||
            format === "open_ended" ||
            format === "coding"
        )
      : [];
    const count =
      value.count === 3 || value.count === 5 || value.count === 8 ||
      value.count === 10 || value.count === 12
        ? value.count
        : DEFAULT_QUIZ_CONFIG.count;
    const languages = [
      "auto",
      "C",
      "C++",
      "C#",
      "Python",
      "Java",
      "JavaScript",
      "TypeScript",
      "Rust",
      "SQL",
      "Go",
    ];
    const language =
      typeof value.language === "string" &&
      languages.includes(value.language)
        ? value.language
        : "auto";
    return {
      formats: formats.length > 0 ? [...new Set(formats)] : ["mcq"],
      count,
      language: language as QuizGenerationConfig["language"],
      difficultyMode: isDifficultyMode(value.difficultyMode)
        ? value.difficultyMode
        : DEFAULT_QUIZ_CONFIG.difficultyMode,
    };
  } catch {
    return DEFAULT_QUIZ_CONFIG;
  }
}

function isDifficultyMode(value: unknown): value is QuizDifficultyMode {
  return value === "easy" || value === "medium" || value === "hard" ||
    value === "progressive" || value === "balanced";
}

export function getDifficultyQuotas(
  count: QuizGenerationConfig["count"],
  mode: QuizDifficultyMode = "medium"
): Record<QuizDifficulty, number> {
  if (mode === "easy" || mode === "medium" || mode === "hard") {
    return {
      easy: mode === "easy" ? count : 0,
      medium: mode === "medium" ? count : 0,
      hard: mode === "hard" ? count : 0,
    };
  }
  const weights: Record<QuizDifficulty, number> =
    mode === "progressive"
      ? { easy: 0.3, medium: 0.4, hard: 0.3 }
      : { easy: 1 / 3, medium: 1 / 3, hard: 1 / 3 };
  const difficulties: QuizDifficulty[] = ["easy", "medium", "hard"];
  const quotas = Object.fromEntries(
    difficulties.map((difficulty) => [
      difficulty,
      Math.floor(count * weights[difficulty]),
    ])
  ) as Record<QuizDifficulty, number>;
  let remainder =
    count - difficulties.reduce((sum, difficulty) => sum + quotas[difficulty], 0);
  const byLargestRemainder = [...difficulties].sort(
    (left, right) =>
      count * weights[right] - Math.floor(count * weights[right]) -
      (count * weights[left] - Math.floor(count * weights[left]))
  );
  for (let index = 0; index < remainder; index += 1) {
    quotas[byLargestRemainder[index % byLargestRemainder.length]] += 1;
  }
  return quotas;
}

function assignDifficultyPlan(
  questions: QuizQuestion[],
  config: QuizGenerationConfig
): QuizQuestion[] {
  const quotas = getDifficultyQuotas(
    config.count,
    config.difficultyMode ?? "medium"
  );
  const plan = (["easy", "medium", "hard"] as const).flatMap((difficulty) =>
    Array.from({ length: quotas[difficulty] }, () => difficulty)
  );
  return questions.map((question, index) => ({
    ...question,
    difficulty: plan[index] ?? "medium",
  }));
}

export function saveQuizPreferences(
  config: QuizGenerationConfig
): void {
  localStorage.setItem(QUIZ_PREFERENCES_KEY, JSON.stringify(config));
}

function extractCandidateQuestionObjects(rawText: string): unknown[] {
  const recovered: unknown[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;

  for (let i = 0; i < rawText.length; i += 1) {
    const ch = rawText[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) objectStart = i;
      depth += 1;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && objectStart >= 0) {
        const candidate = rawText.slice(objectStart, i + 1);
        objectStart = -1;
        if (
          candidate.includes('"prompt"') ||
          candidate.includes('"question"') ||
          candidate.includes('"options"')
        ) {
          try {
            const parsed = parseGeminiJson<Record<string, unknown>>(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              if (Array.isArray(parsed.questions)) {
                recovered.push(...parsed.questions);
              } else {
                recovered.push(parsed);
              }
            }
          } catch {
            // Skip unrecoverable fragment
          }
        }
      }
    }
  }
  return recovered;
}

export function parseQuizPayload(
  rawText: string,
  nodeId: string
): QuizQuestion[] {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = parseGeminiJson<unknown>(stripped || rawText);
    const normalized = normalizeQuizQuestions(
      Array.isArray(parsed) ? { questions: parsed } : parsed,
      nodeId
    );
    if (normalized.length > 0) return normalized;
  } catch {
    // Fall through to balanced-object recovery
  }

  const recovered = extractCandidateQuestionObjects(stripped || rawText);
  if (recovered.length > 0) {
    const normalized = normalizeQuizQuestions({ questions: recovered }, nodeId);
    if (normalized.length > 0) return normalized;
  }

  const parsed = parseGeminiJson<unknown>(rawText);
  return normalizeQuizQuestions(
    Array.isArray(parsed) ? { questions: parsed } : parsed,
    nodeId
  );
}

function getExpectedFormatCounts(
  config: QuizGenerationConfig
): Map<QuizQuestionType, number> {
  const counts = new Map<QuizQuestionType, number>();
  const formats = [...new Set(config.formats)];
  formats.forEach((format, index) => {
    counts.set(
      format,
      Math.floor(config.count / formats.length) +
        (index < config.count % formats.length ? 1 : 0)
    );
  });
  return counts;
}

function formatCountsDescription(counts: Map<QuizQuestionType, number>): string {
  return [...counts]
    .filter(([, count]) => count > 0)
    .map(([format, count]) => `${count} ${format}`)
    .join(", ");
}

function getGenerationTokenBudget(
  counts: Map<QuizQuestionType, number>
): number {
  const tokensPerQuestion: Record<QuizQuestionType, number> = {
    mcq: 220,
    open_ended: 300,
    coding: 650,
  };
  let total = 200;
  for (const [format, count] of counts) {
    total += tokensPerQuestion[format] * count;
  }
  return total;
}

function selectQuestionsForCounts(
  questions: QuizQuestion[],
  counts: Map<QuizQuestionType, number>,
  language: QuizGenerationConfig["language"]
): QuizQuestion[] {
  const remaining = new Map(counts);
  const selected: QuizQuestion[] = [];
  for (const question of questions) {
    if (question.type === "coding") {
      if (
        language === "auto" &&
        !SUPPORTED_CODING_LANGUAGES.includes(question.language ?? "")
      ) {
        continue;
      }
      if (language !== "auto") question.language = language;
    }

    const slots = remaining.get(question.type) ?? 0;
    if (slots <= 0) continue;
    selected.push(question);
    remaining.set(question.type, slots - 1);
  }
  return selected;
}

function getMissingQuestionCounts(
  questions: QuizQuestion[],
  expected: Map<QuizQuestionType, number>
): Map<QuizQuestionType, number> {
  const actual = new Map<QuizQuestionType, number>();
  for (const question of questions) {
    actual.set(question.type, (actual.get(question.type) ?? 0) + 1);
  }
  return new Map(
    [...expected]
      .map(([format, count]) => [
        format,
        Math.max(0, count - (actual.get(format) ?? 0)),
      ] as const)
      .filter(([, count]) => count > 0)
  );
}

function appendWithUniqueIds(
  existing: QuizQuestion[],
  additions: QuizQuestion[],
  attempt: number
): QuizQuestion[] {
  const usedIds = new Set(existing.map((question) => question.id));
  return additions.map((question, index) => {
    let id = question.id;
    if (usedIds.has(id)) {
      id = `${id}-supplement-${attempt}-${index + 1}`;
      let suffix = 1;
      while (usedIds.has(id)) {
        id = `${question.id}-supplement-${attempt}-${index + 1}-${suffix++}`;
      }
    }
    usedIds.add(id);
    return id === question.id ? question : { ...question, id };
  });
}

function describeMissingQuestions(
  missing: Map<QuizQuestionType, number>
): string {
  return [...missing]
    .map(([format, count]) => `${count} ${format}`)
    .join(", ");
}

const SUPPORTED_CODING_LANGUAGES = [
  "C",
  "C++",
  "C#",
  "Python",
  "Java",
  "JavaScript",
  "TypeScript",
  "Rust",
  "SQL",
  "Go",
];

export interface QuizBatchProgress {
  completed: number;
  total: number;
}

function getRateLimitMessage(error: unknown): Error {
  const details = error instanceof Error ? error.message : String(error);
  return new Error(
    `The AI provider rate limit was reached during quiz generation. Wait for the limit to reset, try fewer questions, or use a local AI model. Details: ${details}`
  );
}

export function getLocalQuizBatches(
  expectedCounts: Map<QuizQuestionType, number>,
  outputTokenBudget: number
): Array<Map<QuizQuestionType, number>> {
  const batches: Array<Map<QuizQuestionType, number>> = [];
  const tokensPerQuestion: Record<QuizQuestionType, number> = {
    mcq: 220,
    open_ended: 300,
    coding: 650,
  };
  for (const [type, count] of expectedCounts) {
    const maxPerBatch = type === "mcq" ? 5 : 2;
    const batchSize = Math.max(
      1,
      Math.min(
        maxPerBatch,
        Math.floor((outputTokenBudget - 200) / tokensPerQuestion[type])
      )
    );
    for (let remaining = count; remaining > 0; remaining -= batchSize) {
      batches.push(new Map([[type, Math.min(batchSize, remaining)]]));
    }
  }
  return batches;
}

export async function generateNodeQuiz(
  node: GraphNode,
  config: QuizGenerationConfig,
  onProgress?: (progress: QuizBatchProgress) => void,
  signal?: AbortSignal
): Promise<QuizQuestion[]> {
  if (config.formats.length === 0) {
    throw new Error("Select at least one question format.");
  }

  const lesson = minifyContextText(
    node.lesson_markdown ?? `${node.title}\n${node.summary_hint}`
  ).slice(0, 1600);
  const keyTakeaways =
    lesson.match(
      /(?:^|\n)#{1,3}\s*(?:key takeaways|takeaways)\s*\n([\s\S]*?)(?=\n#{1,3}\s|$)/i
    )?.[1]?.trim() ?? node.summary_hint;
  const expectedCounts = getExpectedFormatCounts(config);
  const requestedLanguage =
    config.language === "auto"
      ? "Auto-detect from the lesson, then return the chosen language explicitly."
      : config.language;
  const prompt = `Lesson: ${node.title}\nRequired questions: ${formatCountsDescription(
    expectedCounts
  )} (total ${config.count})\nTarget language: ${requestedLanguage}\nKey takeaways: ${keyTakeaways.slice(
    0,
    500
  )}\nLesson reference:\n${lesson}`;
  const maxOutputTokens = getGenerationTokenBudget(expectedCounts);
  const questionSchema = getQuestionSchema(expectedCounts.keys());
  const systemInstruction =
    "Return one JSON object matching the schema, grounded in the lesson. Follow the requested format counts exactly. MCQs need four distinct options and a correct answerIndex. Keep explanations, rubrics, and reference answers concise. Coding questions need a small starterCode and 1-3 testCases. Use no Markdown.";
  let questions: QuizQuestion[] = [];
  let lastError = "The generated quiz did not contain valid questions.";
  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new DOMException("Quiz generation stopped.", "AbortError");
    }
  };

  const providerSettings = loadAiSettings();
  if (
    providerSettings.provider === "openai-compatible" &&
    isLocalAiEndpoint(providerSettings.localBaseUrl)
  ) {
    const batches = getLocalQuizBatches(
      expectedCounts,
      getLocalOutputTokenBudget(maxOutputTokens)
    );
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      throwIfAborted();
      const batchCounts = batches[batchIndex];
      let batchQuestions: QuizQuestion[] = [];
      onProgress?.({ completed: batchIndex, total: batches.length });

      for (let attempt = 0; attempt < 2; attempt += 1) {
        throwIfAborted();
        const missing = getMissingQuestionCounts(batchQuestions, batchCounts);
        if (missing.size === 0) break;
        const existingQuestions = [...questions, ...batchQuestions]
          .map(
            (question) =>
              `- ${question.type}: ${question.prompt.slice(0, 180)}`
          )
          .join("\n");
        const missingCount = [...missing.values()].reduce(
          (total, count) => total + count,
          0
        );
        const batchPrompt = `${prompt}\n\nBatch ${batchIndex + 1} of ${batches.length}: generate exactly ${missingCount} question(s), only in these formats/counts: ${formatCountsDescription(missing)}.\nPreviously generated prompts (do not repeat):\n${existingQuestions || "(none)"}${attempt > 0 ? `\nThe prior batch response was incomplete: ${lastError}. Return only the missing questions.` : ""}`;

        try {
          const raw = await generateGeminiJson<unknown>({
            tier: "fast",
            temperature: attempt === 0 ? 0.2 : 0,
            maxOutputTokens: getGenerationTokenBudget(missing),
            systemInstruction,
            userPrompt: batchPrompt,
            jsonSchema: getQuestionSchema(missing.keys()),
            rateLimitMode: "fail-fast",
            signal,
          });
          const additions = selectQuestionsForCounts(
            normalizeQuizQuestions(raw, node.id, {
              codingLanguage:
                config.language === "auto" ? undefined : config.language,
            }),
            missing,
            config.language
          );
          const uniqueAdditions = appendWithUniqueIds(
            [...questions, ...batchQuestions],
            additions,
            batchIndex * 2 + attempt + 1
          );
          if (uniqueAdditions.length === 0) {
            throw new Error(
              `The model returned no valid questions for ${formatCountsDescription(missing)}.`
            );
          }
          batchQuestions = selectQuestionsForCounts(
            [...batchQuestions, ...uniqueAdditions],
            batchCounts,
            config.language
          );
        } catch (error) {
          if (signal?.aborted) throw error;
          if (isRateLimitApiError(error)) throw getRateLimitMessage(error);
          lastError = error instanceof Error ? error.message : String(error);
          if (attempt === 1) {
            throw new Error(
              `Local quiz batch ${batchIndex + 1} of ${batches.length} failed: ${lastError}`
            );
          }
        }
      }

      const missing = getMissingQuestionCounts(batchQuestions, batchCounts);
      if (missing.size > 0) {
        throw new Error(
          `Local quiz generation omitted ${describeMissingQuestions(missing)} after one retry.`
        );
      }
      questions = selectQuestionsForCounts(
        [...questions, ...batchQuestions],
        expectedCounts,
        config.language
      );
      onProgress?.({ completed: batchIndex + 1, total: batches.length });
    }
    return assignDifficultyPlan(questions, config);
  }

  for (let attempt = 0; attempt < 2 && questions.length === 0; attempt += 1) {
    throwIfAborted();
    try {
      const raw = await generateGeminiJson<unknown>({
        tier: "fast",
        temperature: attempt === 0 ? 0.2 : 0,
        maxOutputTokens,
        systemInstruction,
        userPrompt:
          attempt === 0
            ? prompt
            : `${prompt}\n\nThe previous response could not be used: ${lastError} Return one complete JSON object with exactly ${config.count} valid questions and the requested format counts.`,
        jsonSchema: questionSchema,
        rateLimitMode: "fail-fast",
        signal,
      });
      questions = selectQuestionsForCounts(
        normalizeQuizQuestions(raw, node.id, {
          codingLanguage:
            config.language === "auto" ? undefined : config.language,
        }),
        expectedCounts,
        config.language
      );
      if (questions.length === 0) {
        throw new Error("The model returned no valid requested question formats.");
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isRateLimitApiError(error)) throw getRateLimitMessage(error);
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        throw new Error(
          `Quiz generation returned no valid questions after one retry: ${lastError}`
        );
      }
    }
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    throwIfAborted();
    const missing = getMissingQuestionCounts(questions, expectedCounts);
    if (missing.size === 0) {
      onProgress?.({ completed: 1, total: 1 });
      return assignDifficultyPlan(questions, config);
    }

    const missingCount = [...missing.values()].reduce(
      (total, count) => total + count,
      0
    );
    const existingQuestions = questions
      .map((question) => `- ${question.type}: ${question.prompt.slice(0, 180)}`)
      .join("\n");
    const completionPrompt = `${prompt}\n\nValid questions already generated:\n${existingQuestions}\nMissing question counts: ${formatCountsDescription(missing)}.\n${
      attempt > 1 ? `Previous supplement issue: ${lastError}\n` : ""
    }Generate exactly ${missingCount} additional question(s), only in those missing formats. Do not repeat an existing question. Every coding question must include language, starterCode, testCases, rubric, and referenceAnswer. Return one JSON object with a questions array.`;

    try {
      const raw = await generateGeminiJson<unknown>({
        tier: "fast",
        temperature: 0,
        maxOutputTokens: getGenerationTokenBudget(missing),
        systemInstruction,
        userPrompt: completionPrompt,
        jsonSchema: getQuestionSchema(missing.keys()),
        rateLimitMode: "fail-fast",
        signal,
      });
      const additions = selectQuestionsForCounts(
        normalizeQuizQuestions(raw, node.id, {
          codingLanguage:
            config.language === "auto" ? undefined : config.language,
        }),
        missing,
        config.language
      );
      const uniqueAdditions = appendWithUniqueIds(
        questions,
        additions,
        attempt
      );
      if (uniqueAdditions.length === 0) {
        throw new Error(
          `The model did not provide the missing question formats: ${describeMissingQuestions(missing)}.`
        );
      }

      questions = selectQuestionsForCounts(
        [...questions, ...uniqueAdditions],
        expectedCounts,
        config.language
      );
      const remaining = getMissingQuestionCounts(questions, expectedCounts);
      if (remaining.size > 0) {
        lastError = `The model still omitted: ${describeMissingQuestions(remaining)}.`;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isRateLimitApiError(error)) throw getRateLimitMessage(error);
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const missing = getMissingQuestionCounts(questions, expectedCounts);
  const aiSettings = loadAiSettings();
  const localModelHint =
    aiSettings.provider === "openai-compatible" &&
    isLocalAiEndpoint(aiSettings.localBaseUrl)
      ? " For a local model, increase the maximum response tokens in Settings or reduce the question count."
      : "";
  throw new Error(
    `Quiz generation produced ${questions.length} of ${config.count} valid questions. Missing: ${describeMissingQuestions(missing) || "unknown formats"}. ${lastError}${localModelHint}`
  );
}

export interface SubjectiveQuizItem {
  id: string;
  type: "open_ended" | "coding";
  prompt: string;
  answer: string;
  rubric: string;
  referenceAnswer: string;
  language?: string;
  testCases?: string[];
}

export async function gradeSubjectiveBatch(
  items: SubjectiveQuizItem[]
): Promise<QuizGradingResult[]> {
  if (items.length === 0) return [];

  const response = await generateGeminiJson<unknown>({
    tier: "fast",
    temperature: 0,
    maxOutputTokens: Math.min(1400, 240 * items.length),
    systemInstruction:
      "Grade every submitted answer against its rubric and reference answer. Do not execute code. Return one result per input id with score from 0 to 1, passed as score >= 0.7, concise feedback, and an optimalSolution. Return a root JSON object.",
    userPrompt: `Grade these assessment answers:\n${minifyContextText(
      JSON.stringify(items)
    )}`,
    jsonSchema: {
      type: "OBJECT",
      properties: {
        results: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              score: { type: "NUMBER" },
              passed: { type: "BOOLEAN" },
              feedback: { type: "STRING" },
              optimalSolution: { type: "STRING" },
            },
            required: [
              "id",
              "score",
              "passed",
              "feedback",
              "optimalSolution",
            ],
          },
        },
      },
      required: ["results"],
    },
  });

  if (!response || typeof response !== "object" || !("results" in response)) {
    throw new Error("Grading response did not contain a results array.");
  }
  const results = (response as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    throw new Error("Grading response did not contain a results array.");
  }
  const byId = new Map<string, QuizGradingResult>();
  for (const result of results) {
    if (
      result &&
      typeof result === "object" &&
      "id" in result &&
      "score" in result &&
      "passed" in result &&
      "feedback" in result &&
      "optimalSolution" in result
    ) {
      const item = result as Record<string, unknown>;
      if (
        typeof item.id === "string" &&
        typeof item.score === "number" &&
        Number.isFinite(item.score) &&
        item.score >= 0 &&
        item.score <= 1 &&
        typeof item.passed === "boolean" &&
        typeof item.feedback === "string" &&
        typeof item.optimalSolution === "string"
      ) {
        byId.set(item.id, {
          id: item.id,
          score: item.score,
          passed: item.score >= 0.7,
          feedback: item.feedback,
          optimalSolution: item.optimalSolution,
        });
      }
    }
  }

  if (items.some((item) => !byId.has(item.id))) {
    throw new Error("Grading response was incomplete. Please retry submission.");
  }
  return items.map((item) => byId.get(item.id)!);
}
