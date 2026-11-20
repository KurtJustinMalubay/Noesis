import type {
  QuizQuestion,
  QuizQuestionType,
} from "../types/domain";

const QUESTION_TYPES = new Set<QuizQuestionType>([
  "mcq",
  "open_ended",
  "coding",
]);

export function normalizeQuizQuestions(
  value: unknown,
  nodeId: string
): QuizQuestion[] {
  const rawQuestions = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (value as Record<string, unknown>).questions
      : null;
  if (!Array.isArray(rawQuestions)) {
    throw new Error("Quiz response must contain a root object with questions.");
  }

  const questions: QuizQuestion[] = [];
  const seenIds = new Set<string>();
  for (const rawQuestion of rawQuestions) {
    if (
      !rawQuestion ||
      typeof rawQuestion !== "object" ||
      Array.isArray(rawQuestion)
    ) {
      continue;
    }

    const item = rawQuestion as Record<string, unknown>;
    const type =
      typeof item.type === "string" && QUESTION_TYPES.has(item.type as QuizQuestionType)
        ? (item.type as QuizQuestionType)
        : item.question && Array.isArray(item.options)
          ? "mcq"
          : null;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const prompt = item.prompt ?? item.question ?? item.q;
    const explanation = item.explanation;
    if (
      !type ||
      !id ||
      typeof prompt !== "string" ||
      !prompt.trim() ||
      typeof explanation !== "string" ||
      !explanation.trim() ||
      seenIds.has(id)
    ) {
      continue;
    }
    seenIds.add(id);

    const normalized: QuizQuestion = {
      id,
      type,
      prompt,
      explanation,
      sourceNodeId: nodeId,
    };

    if (type === "mcq") {
      const options = item.options;
      const answerIndex = item.answerIndex ?? item.correctIndex;
      if (
        !Array.isArray(options) ||
        options.length !== 4 ||
        !options.every(
          (option) => typeof option === "string" && option.trim().length > 0
        ) ||
        new Set(
          options.map((option) =>
            typeof option === "string" ? option.trim().toLowerCase() : ""
          )
        ).size !== 4 ||
        !Number.isInteger(answerIndex) ||
        (answerIndex as number) < 0 ||
        (answerIndex as number) > 3
      ) {
        continue;
      }
      normalized.options = options as string[];
      normalized.answerIndex = answerIndex as number;
    } else {
      if (
        typeof item.rubric !== "string" ||
        !item.rubric.trim() ||
        typeof item.referenceAnswer !== "string" ||
        !item.referenceAnswer.trim()
      ) {
        continue;
      }
      normalized.rubric = item.rubric;
      normalized.referenceAnswer = item.referenceAnswer;
      if (type === "coding") {
        if (
          typeof item.language !== "string" ||
          typeof item.starterCode !== "string" ||
          !Array.isArray(item.testCases) ||
          !item.testCases.every((testCase) => typeof testCase === "string")
        ) {
          continue;
        }
        normalized.language = item.language;
        normalized.starterCode = item.starterCode;
        normalized.testCases = item.testCases as string[];
      }
    }

    questions.push(normalized);
  }

  if (questions.length === 0) {
    throw new Error("Quiz response contained no valid questions. Please retry.");
  }
  return questions;
}
