import type {
  QuizDraft,
  QuizGenerationConfig,
  QuizQuestion,
  QuizRecord,
} from "../../types/domain";
import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";
import { normalizeQuizQuestions } from "../../ai/diagnosticQuiz";

const LEGACY_CONFIG: QuizGenerationConfig = {
  formats: ["mcq"],
  count: 5,
  language: "auto",
  difficultyMode: "medium",
};

export async function getNodeQuiz(
  nodeId: string
): Promise<QuizRecord | null> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      questions_json: string;
      config_json: string;
      draft_json: string;
      score: number | null;
    }>
  >(
    "SELECT questions_json, config_json, draft_json, score FROM node_quizzes WHERE node_id = $1 LIMIT 1",
    [nodeId]
  );
  if (!rows[0]) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rows[0].questions_json) as unknown;
  } catch (error) {
    throw new Error(
      `Saved mastery quiz is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const questions = normalizeQuizQuestions(parsed, nodeId);
  let config = LEGACY_CONFIG;
  let draft: QuizDraft = { answers: {}, currentQuestionIndex: 0 };
  try {
    const storedConfig = JSON.parse(rows[0].config_json) as QuizGenerationConfig;
    if (
      Array.isArray(storedConfig.formats) &&
      [3, 5, 8, 10, 12].includes(storedConfig.count) &&
      typeof storedConfig.language === "string"
    ) {
      config = {
        ...storedConfig,
        difficultyMode:
          storedConfig.difficultyMode === "easy" ||
          storedConfig.difficultyMode === "hard" ||
          storedConfig.difficultyMode === "progressive" ||
          storedConfig.difficultyMode === "balanced"
            ? storedConfig.difficultyMode
            : "medium",
      };
    }
  } catch {
    config = LEGACY_CONFIG;
  }
  try {
    const storedDraft = JSON.parse(rows[0].draft_json) as Partial<QuizDraft>;
    if (
      storedDraft.answers &&
      typeof storedDraft.answers === "object" &&
      !Array.isArray(storedDraft.answers)
    ) {
      draft = {
        answers: storedDraft.answers,
        currentQuestionIndex:
          Number.isInteger(storedDraft.currentQuestionIndex) &&
          (storedDraft.currentQuestionIndex ?? -1) >= 0
            ? storedDraft.currentQuestionIndex!
            : 0,
        difficultyMode:
          storedDraft.difficultyMode === "easy" ||
          storedDraft.difficultyMode === "hard" ||
          storedDraft.difficultyMode === "progressive" ||
          storedDraft.difficultyMode === "balanced"
            ? storedDraft.difficultyMode
            : "medium",
        results: Array.isArray(storedDraft.results)
          ? storedDraft.results
          : undefined,
        languageByQuestion:
          storedDraft.languageByQuestion &&
          typeof storedDraft.languageByQuestion === "object"
            ? storedDraft.languageByQuestion
            : undefined,
        score:
          typeof storedDraft.score === "number" ? storedDraft.score : undefined,
      };
    }
  } catch {
    draft = { answers: {}, currentQuestionIndex: 0 };
  }

  return { questions, config, draft, score: rows[0].score };
}

export async function hasNodeQuiz(nodeId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<Array<{ present: number }>>(
    "SELECT 1 AS present FROM node_quizzes WHERE node_id = $1 LIMIT 1",
    [nodeId]
  );
  return rows.length > 0;
}

export async function saveNodeQuiz(
  nodeId: string,
  questions: QuizQuestion[],
  config: QuizGenerationConfig
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `INSERT OR REPLACE INTO node_quizzes
        (node_id, quiz_type, questions_json, best_score, attempt_count,
         updated_at, config_json, draft_json, score)
       VALUES (
        $1,
        'mastery_arena',
        $2,
        COALESCE((SELECT best_score FROM node_quizzes WHERE node_id = $1), 0),
        COALESCE((SELECT attempt_count FROM node_quizzes WHERE node_id = $1), 0),
        $3,
        $4,
        '{}',
        NULL
       )`,
      [nodeId, JSON.stringify(questions), Date.now(), JSON.stringify(config)]
    )
  );
}

export async function saveNodeQuizDraft(
  nodeId: string,
  draft: QuizDraft
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      "UPDATE node_quizzes SET draft_json = $1, updated_at = $2 WHERE node_id = $3",
      [JSON.stringify(draft), Date.now(), nodeId]
    )
  );
}

export async function saveNodeQuizScore(
  nodeId: string,
  score: number,
  draft: QuizDraft
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      "UPDATE node_quizzes SET score = $1, draft_json = $2, attempt_count = attempt_count + 1, best_score = MAX(best_score, $1), updated_at = $3 WHERE node_id = $4",
      [score, JSON.stringify(draft), Date.now(), nodeId]
    )
  );
}

export async function resetNodeQuizAttempt(nodeId: string): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      "UPDATE node_quizzes SET score = NULL, draft_json = '{}', updated_at = $1 WHERE node_id = $2",
      [Date.now(), nodeId]
    )
  );
}
