import {
  generateGeminiJson,
  parseGeminiJson,
} from "./geminiClient.ts";
import { minifyContextText } from "./tokenOptimizer.ts";
import { normalizeQuizQuestions } from "./diagnosticQuiz.ts";
import type {
  GraphNode,
  QuizGenerationConfig,
  QuizGradingResult,
  QuizQuestion,
  QuizQuestionType,
} from "../types/domain";

const QUIZ_PREFERENCES_KEY = "noesis.quiz-preferences.v1";

export const DEFAULT_QUIZ_CONFIG: QuizGenerationConfig = {
  formats: ["mcq"],
  count: 5,
  language: "auto",
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
          explanation: { type: "STRING" },
        },
        required: ["id", "type", "prompt", "explanation"],
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
      value.count === 3 || value.count === 5 || value.count === 8
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
    };
  } catch {
    return DEFAULT_QUIZ_CONFIG;
  }
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

function getFormatCounts(config: QuizGenerationConfig): string {
  const counts = new Map<QuizQuestionType, number>();
  const formats: QuizQuestionType[] =
    config.formats.length > 0 ? config.formats : ["mcq"];
  formats.forEach((format, index) => {
    counts.set(
      format,
      Math.floor(config.count / formats.length) +
        (index < config.count % formats.length ? 1 : 0)
    );
  });
  return [...counts]
    .filter(([, count]) => count > 0)
    .map(([format, count]) => `${count} ${format}`)
    .join(", ");
}

export async function generateNodeQuiz(
  node: GraphNode,
  config: QuizGenerationConfig
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
  const formats = config.formats.join(", ");
  const requestedLanguage =
    config.language === "auto"
      ? "Auto-detect from the lesson, then return the chosen language explicitly."
      : config.language;
  const prompt = `Lesson: ${node.title}\nFormats: ${formats}\nQuestion count: ${config.count} (${getFormatCounts(
    config
  )})\nTarget language: ${requestedLanguage}\nKey takeaways: ${keyTakeaways.slice(
    0,
    900
  )}\nLesson reference:\n${lesson.slice(0, 2400)}`;
  const supportedLanguages = [
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
  let validationError = "The generated quiz did not match the requested configuration.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await generateGeminiJson<unknown>({
      tier: "fast",
      temperature: attempt === 0 ? 0.2 : 0,
      maxOutputTokens:
        config.count === 3 ? 900 : config.count === 5 ? 1400 : 2100,
      systemInstruction:
        "Return one JSON object with a questions array, never a root array or markdown. Generate concise, lesson-grounded questions. MCQ requires exactly four options and answerIndex 0-3. Open-ended requires rubric and referenceAnswer. Coding requires rubric, referenceAnswer, starterCode, testCases, and language. Include only fields relevant to each type.",
      userPrompt:
        attempt === 0
          ? prompt
          : `${prompt}\n\nThe previous response was invalid: ${validationError} Return exactly ${config.count} valid questions with the requested format counts.`,
      jsonSchema: QUESTION_SCHEMA,
    });

    try {
      const questions = normalizeQuizQuestions(raw, node.id);
      if (questions.length !== config.count) {
        throw new Error(
          `The model returned ${questions.length} valid questions; ${config.count} were requested.`
        );
      }
      const expectedCounts = new Map<QuizQuestionType, number>();
      config.formats.forEach((format, index) => {
        expectedCounts.set(
          format,
          Math.floor(config.count / config.formats.length) +
            (index < config.count % config.formats.length ? 1 : 0)
        );
      });
      const actualCounts = new Map<QuizQuestionType, number>();
      for (const question of questions) {
        actualCounts.set(
          question.type,
          (actualCounts.get(question.type) ?? 0) + 1
        );
      }
      for (const [format, expected] of expectedCounts) {
        if ((actualCounts.get(format) ?? 0) !== expected) {
          throw new Error(
            `The model returned the wrong number of ${format} questions; ${expected} were requested.`
          );
        }
      }

      for (const question of questions) {
        if (question.type !== "coding") continue;
        if (config.language === "auto") {
          if (!supportedLanguages.includes(question.language ?? "")) {
            throw new Error(
              "The model did not return a supported coding language."
            );
          }
        } else {
          question.language = config.language;
        }
      }
      return questions;
    } catch (error) {
      validationError =
        error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(
    `Quiz generation returned invalid questions after one retry: ${validationError}`
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
