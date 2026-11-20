import {
  generateGeminiJson,
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

const QUESTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          type: {
            type: "STRING",
            enum: ["mcq", "open_ended", "coding"],
          },
          prompt: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } },
          answerIndex: { type: "INTEGER" },
          rubric: { type: "STRING" },
          referenceAnswer: { type: "STRING" },
          language: { type: "STRING" },
          starterCode: { type: "STRING" },
          testCases: { type: "ARRAY", items: { type: "STRING" } },
          hints: { type: "ARRAY", items: { type: "STRING" } },
          explanation: { type: "STRING" },
          difficulty: { type: "STRING", enum: ["easy", "medium", "hard"] },
        },
        required: [
          "id",
          "type",
          "prompt",
          "options",
          "answerIndex",
          "rubric",
          "referenceAnswer",
          "language",
          "starterCode",
          "testCases",
          "explanation",
          "difficulty",
        ],
      },
    },
  },
  required: ["questions"],
};

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

export function parseQuizPayload(
  rawText: string,
  nodeId: string
): QuizQuestion[] {
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
    coding: 700,
  };
  let total = 160;
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

function formatDifficultyQuotas(quotas: Record<QuizDifficulty, number>): string {
  return (["easy", "medium", "hard"] as const)
    .filter((difficulty) => quotas[difficulty] > 0)
    .map((difficulty) => `${quotas[difficulty]} ${difficulty}`)
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

function getLocalQuizBatches(
  expectedCounts: Map<QuizQuestionType, number>
): Array<Map<QuizQuestionType, number>> {
  const batches: Array<Map<QuizQuestionType, number>> = [];
  for (const [type, count] of expectedCounts) {
    const batchSize = type === "mcq" ? 5 : 2;
    for (let remaining = count; remaining > 0; remaining -= batchSize) {
      batches.push(new Map([[type, Math.min(batchSize, remaining)]]));
    }
  }
  return batches;
}

export async function generateNodeQuiz(
  node: GraphNode,
  config: QuizGenerationConfig,
  onProgress?: (progress: QuizBatchProgress) => void
): Promise<QuizQuestion[]> {
  if (config.formats.length === 0) {
    throw new Error("Select at least one question format.");
  }

  const lesson = minifyContextText(
    node.lesson_markdown ?? `${node.title}\n${node.summary_hint}`
  );
  const keyTakeaways =
    lesson.match(
      /(?:^|\n)#{1,3}\s*(?:key takeaways|takeaways)\s*\n([\s\S]*?)(?=\n#{1,3}\s|$)/i
    )?.[1]?.trim() ?? node.summary_hint;
  const expectedCounts = getExpectedFormatCounts(config);
  const formats = [...expectedCounts.keys()].join(", ");
  const requestedLanguage =
    config.language === "auto"
      ? "Auto-detect from the lesson, then return the chosen language explicitly."
      : config.language;
  const prompt = `Lesson: ${node.title}\nFormats: ${formats}\nQuestion count: ${config.count} (${formatCountsDescription(
    expectedCounts
  )})\nTarget language: ${requestedLanguage}\nDifficulty mode: ${config.difficultyMode ?? "medium"}\nDifficulty quotas: ${formatDifficultyQuotas(
    getDifficultyQuotas(config.count, config.difficultyMode ?? "medium")
  )}\nKey takeaways: ${keyTakeaways.slice(
    0,
    900
  )}\nLesson reference:\n${lesson.slice(0, 2400)}`;
  const maxOutputTokens = getGenerationTokenBudget(expectedCounts);
  const systemInstruction =
    "Return one JSON object with a questions array, never a root array or markdown. Generate lesson-grounded questions in the exact requested difficulty quotas and order Easy, then Medium, then Hard. Label each question easy, medium, or hard. Easy is foundational recall/direct single-step application; Medium is conceptual reasoning/multi-step problem solving; Hard is edge cases, synthesis, proofs, or complex debugging. Every question must include every schema field. For MCQ, provide exactly four distinct options and answerIndex 0-3. For open-ended, provide rubric and referenceAnswer. For coding, provide rubric, referenceAnswer, starterCode, testCases, and language. Use empty strings and [] for fields not used by that question type; use answerIndex 0 when it is not an MCQ.";
  let questions: QuizQuestion[] = [];
  let lastError = "The generated quiz did not contain valid questions.";

  if (loadAiSettings().provider === "openai-compatible") {
    const batches = getLocalQuizBatches(expectedCounts);
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batchCounts = batches[batchIndex];
      let batchQuestions: QuizQuestion[] = [];
      onProgress?.({ completed: batchIndex, total: batches.length });

      for (let attempt = 0; attempt < 2; attempt += 1) {
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
            jsonSchema: QUESTION_SCHEMA,
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
        jsonSchema: QUESTION_SCHEMA,
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
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        throw new Error(
          `Quiz generation returned no valid questions after one retry: ${lastError}`
        );
      }
    }
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
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
        jsonSchema: QUESTION_SCHEMA,
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
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const missing = getMissingQuestionCounts(questions, expectedCounts);
  const localModelHint =
    loadAiSettings().provider === "openai-compatible"
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
