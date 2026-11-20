import type {
  QuizQuestion,
  QuizQuestionType,
} from "../types/domain";

const QUESTION_TYPE_ALIASES: Record<string, QuizQuestionType> = {
  mcq: "mcq",
  multiple_choice: "mcq",
  "multiple-choice": "mcq",
  "multiple choice": "mcq",
  open_ended: "open_ended",
  "open-ended": "open_ended",
  "open ended": "open_ended",
  coding: "coding",
  code: "coding",
  coding_challenge: "coding",
  "coding challenge": "coding",
};

function getQuestionType(
  item: Record<string, unknown>
): QuizQuestionType | null {
  const rawType = item.type ?? item.format ?? item.questionType;
  if (typeof rawType === "string") {
    const normalized = QUESTION_TYPE_ALIASES[rawType.trim().toLowerCase()];
    if (normalized) return normalized;
  }
  if (
    Array.isArray(item.options) ||
    Array.isArray(item.choices) ||
    Array.isArray(item.answers)
  ) {
    return "mcq";
  }
  if (
    typeof item.language === "string" ||
    typeof item.starterCode === "string" ||
    typeof item.codeTemplate === "string" ||
    Array.isArray(item.testCases)
  ) {
    return "coding";
  }
  if (
    typeof item.rubric === "string" ||
    typeof item.referenceAnswer === "string" ||
    typeof item.expectedAnswer === "string"
  ) {
    return "open_ended";
  }
  return null;
}

function normalizeOptions(value: unknown): string[] {
  let candidates: unknown[];
  if (Array.isArray(value)) {
    candidates = value;
  } else if (value && typeof value === "object") {
    candidates = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, option]) => option);
  } else {
    candidates = [];
  }

  const options = candidates.map((option) => {
    if (typeof option === "string") return option.trim();
    if (option && typeof option === "object" && !Array.isArray(option)) {
      const record = option as Record<string, unknown>;
      const text = record.text ?? record.label ?? record.value;
      return typeof text === "string" ? text.trim() : "";
    }
    return typeof option === "number" || typeof option === "boolean"
      ? String(option)
      : "";
  });
  const normalized = options.filter(Boolean).slice(0, 4);
  while (normalized.length < 4) {
    normalized.push(`Option ${String.fromCharCode(65 + normalized.length)}`);
  }
  const unique = new Set<string>();
  return normalized.map((option, index) => {
    let candidate = option;
    let suffix = index + 1;
    while (unique.has(candidate.toLowerCase())) {
      candidate = `${option} (${suffix++})`;
    }
    unique.add(candidate.toLowerCase());
    return candidate;
  });
}

function normalizeAnswerIndex(
  item: Record<string, unknown>,
  options: string[]
): number | null {
  const rawIndex = item.answerIndex ?? item.correctIndex;
  if (
    typeof rawIndex === "number" &&
    Number.isInteger(rawIndex) &&
    rawIndex >= 0 &&
    rawIndex < options.length
  ) {
    return rawIndex;
  }

  const rawAnswer =
    item.correctAnswer ?? item.answer ?? item.answerKey ?? item.correct;
  if (typeof rawAnswer === "number" && Number.isInteger(rawAnswer)) {
    if (rawAnswer >= 0 && rawAnswer < options.length) return rawAnswer;
    if (rawAnswer >= 1 && rawAnswer <= options.length) return rawAnswer - 1;
  }
  if (typeof rawAnswer !== "string") return null;

  const answer = rawAnswer.trim();
  const letter = answer.match(/^(?:option\s*)?([a-d])(?:[\s).:]|$)/i);
  if (letter) return letter[1].toUpperCase().charCodeAt(0) - 65;
  const number = answer.match(/^(?:option\s*)?([1-4])(?:[\s).:]|$)/i);
  if (number) return Number(number[1]) - 1;

  const normalizedAnswer = answer.toLowerCase();
  const matchingOption = options.findIndex(
    (option) => option.trim().toLowerCase() === normalizedAnswer
  );
  return matchingOption >= 0 ? matchingOption : null;
}

function getString(
  item: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeTestCases(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : value === null || value === undefined
      ? []
      : [value];
  return candidates
    .map((testCase) => {
      if (typeof testCase === "string") return testCase.trim();
      if (typeof testCase === "number" || typeof testCase === "boolean") {
        return String(testCase);
      }
      if (testCase && typeof testCase === "object") {
        return JSON.stringify(testCase);
      }
      return "";
    })
    .filter(Boolean);
}

function normalizeHints(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : [];
  return candidates
    .filter((hint): hint is string => typeof hint === "string")
    .map((hint) => hint.trim())
    .filter(Boolean);
}

export function normalizeQuizQuestions(
  value: unknown,
  nodeId: string,
  defaults: { codingLanguage?: string } = {}
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
  for (let index = 0; index < rawQuestions.length; index += 1) {
    const rawQuestion = rawQuestions[index];
    if (
      !rawQuestion ||
      typeof rawQuestion !== "object" ||
      Array.isArray(rawQuestion)
    ) {
      continue;
    }

    const item = rawQuestion as Record<string, unknown>;
    const rawPrompt = getString(item, "prompt", "question", "q", "stem");
    const type =
      getQuestionType(item) ?? (rawPrompt ? "open_ended" : null);
    if (!type) continue;
    const prompt = rawPrompt ?? "Explain the key idea from this lesson.";

    const requestedId = getString(item, "id", "questionId");
    let id = requestedId ?? `${nodeId}-question-${index + 1}`;
    if (seenIds.has(id)) {
      id = `${nodeId}-question-${index + 1}`;
      let suffix = 1;
      while (seenIds.has(id)) {
        id = `${nodeId}-question-${index + 1}-${suffix++}`;
      }
    }
    seenIds.add(id);

    const normalized: QuizQuestion = {
      id,
      type,
      prompt,
      explanation:
        getString(item, "explanation", "rationale") ??
        "Review the lesson section related to this question.",
      sourceNodeId: nodeId,
    };
    const rawDifficulty = item.difficulty;
    normalized.difficulty =
      rawDifficulty === "easy" ||
      rawDifficulty === "medium" ||
      rawDifficulty === "hard"
        ? rawDifficulty
        : "medium";

    if (type === "mcq") {
      const options = normalizeOptions(
        item.options ?? item.choices ?? item.answers
      );
      const answerIndex = normalizeAnswerIndex(item, options) ?? 0;
      normalized.options = options;
      normalized.answerIndex = answerIndex;
    } else {
      const referenceAnswer = getString(
        item,
        "referenceAnswer",
        "sampleAnswer",
        "referenceSolution",
        "expectedAnswer",
        "modelAnswer",
        "solution",
        "answer",
        "explanation"
      );
      normalized.referenceAnswer =
        referenceAnswer ?? `A correct response should address: ${prompt}`;
      const expectedKeyPoints = normalizeHints(item.expectedKeyPoints).join("; ");
      normalized.rubric =
        getString(item, "rubric", "gradingCriteria") ??
        (expectedKeyPoints ||
          "Assess accuracy, completeness, and whether the response addresses the prompt.");
      if (type === "coding") {
        normalized.language =
          getString(item, "language", "programmingLanguage") ??
          defaults.codingLanguage ??
          "auto";
        normalized.starterCode =
          (getString(item, "starterCode", "codeTemplate", "template") ?? "")
            .replace(/\\r\\n/g, "\n")
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t");
        normalized.testCases = normalizeTestCases(
          item.testCases ?? item.sampleCases ?? item.examples
        );
        normalized.hints = normalizeHints(item.hints);
      }
    }

    questions.push(normalized);
  }

  if (questions.length === 0) {
    throw new Error("Quiz response contained no valid questions. Please retry.");
  }
  return questions;
}
