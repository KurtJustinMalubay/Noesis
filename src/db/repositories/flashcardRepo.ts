import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";
import { buildMultiRowInsert } from "../batch";
import type { Flashcard } from "../../types/domain";

export interface DueFlashcard extends Flashcard {
  node_title: string;
}

export async function getDueFlashcards(
  workspaceId: string,
  nowMs: number = Date.now()
): Promise<DueFlashcard[]> {
  const db = await getDb();
  return db.select<DueFlashcard[]>(
    `SELECT f.*, n.title AS node_title
     FROM flashcards f
     JOIN nodes n ON n.id = f.node_id
     WHERE n.workspace_id = $1
       AND n.archived_at IS NULL
       AND f.next_review_at <= $2
     ORDER BY f.next_review_at ASC`,
    [workspaceId, nowMs]
  );
}

export async function getNodeFlashcards(nodeId: string): Promise<Flashcard[]> {
  const db = await getDb();
  return db.select<Flashcard[]>(
    "SELECT * FROM flashcards WHERE node_id = $1 ORDER BY next_review_at ASC",
    [nodeId]
  );
}

export async function updateFlashcardSchedule(card: Flashcard): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `UPDATE flashcards
     SET ease_factor = $1,
         interval_days = $2,
         repetitions = $3,
         next_review_at = $4
     WHERE id = $5`,
      [
        card.ease_factor,
        card.interval_days,
        card.repetitions,
        card.next_review_at,
        card.id,
      ]
    )
  );
}

export async function updateFlashcardSchedules(
  cards: Flashcard[]
): Promise<void> {
  if (cards.length === 0) return;
  const db = await getDb();
  const batches = buildMultiRowInsert(
    "flashcards",
    [
      "id",
      "node_id",
      "front",
      "back",
      "ease_factor",
      "interval_days",
      "repetitions",
      "next_review_at",
    ],
    cards.map((card) => [
      card.id,
      card.node_id,
      card.front,
      card.back,
      card.ease_factor,
      card.interval_days,
      card.repetitions,
      card.next_review_at,
    ]),
    "INSERT OR REPLACE"
  );
  await serializeDbWrite(async () => {
    for (const batch of batches) {
      await db.execute(batch.sql, batch.params);
    }
  });
}