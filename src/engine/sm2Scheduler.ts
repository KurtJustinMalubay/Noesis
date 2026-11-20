import type { Flashcard } from "../types/domain";

export type ReviewGrade = 0 | 1 | 2 | 3; // 0: Again, 1: Hard, 2: Good, 3: Easy

const DAY_MS = 24 * 60 * 60 * 1000;

// Maps 4-button UX grades onto standard SM-2 quality scale (0..5)
const GRADE_TO_QUALITY: Record<ReviewGrade, number> = {
  0: 1, // Again -> reset repetitions
  1: 3, // Hard -> pass with difficulty
  2: 4, // Good -> standard recall
  3: 5, // Easy -> effortless recall
};

export function scheduleNextReview(
  card: Flashcard,
  grade: ReviewGrade,
  nowMs: number = Date.now()
): Flashcard {
  const q = GRADE_TO_QUALITY[grade];

  let repetitions = card.repetitions;
  let intervalDays = card.interval_days;
  let easeFactor = card.ease_factor;

  if (q < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    repetitions += 1;

    if (grade === 1) {
      intervalDays = Math.max(1, Math.round(intervalDays * 0.8));
    } else if (grade === 3) {
      intervalDays = Math.round(intervalDays * 1.3) + 1;
    }
  }

  // Standard SM-2 ease factor update clamped at 1.3 minimum
  easeFactor =
    easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easeFactor < 1.3) {
    easeFactor = 1.3;
  }

  return {
    ...card,
    ease_factor: Number(easeFactor.toFixed(2)),
    interval_days: intervalDays,
    repetitions,
    next_review_at: nowMs + intervalDays * DAY_MS,
  };
}