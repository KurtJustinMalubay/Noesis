import { getDb } from "../client";
import type { NodeStatus } from "../../types/domain";

export interface DashboardWorkspaceSummary {
  id: string;
  title: string;
  root_domain: string;
  updated_at: number;
  nodeCount: number;
  masteredCount: number;
  inProgressCount: number;
  unlockedCount: number;
  dueFlashcardCount: number;
}

export interface DashboardConceptItem {
  id: string;
  workspace_id: string;
  workspace_title: string;
  title: string;
  summary_hint: string;
  status: NodeStatus;
  updated_at: number;
}

export interface DashboardQuizItem {
  node_id: string;
  workspace_id: string;
  workspace_title: string;
  node_title: string;
  score: number | null;
  best_score: number;
  attempt_count: number;
  updated_at: number;
}

export interface DashboardCurriculumSummary {
  id: string;
  title: string;
  subject_count: number;
  linked_count: number;
  nodeCount: number;
  masteredCount: number;
  updated_at: number;
}

export interface DashboardTotals {
  workspaceCount: number;
  curriculumCount: number;
  nodeCount: number;
  masteredCount: number;
  inProgressCount: number;
  unlockedCount: number;
  lockedCount: number;
  flashcardCount: number;
  dueFlashcardCount: number;
  overdueFlashcardCount: number;
  dueTodayFlashcardCount: number;
  quizCount: number;
  averageQuizScore: number | null;
}

export interface DashboardSnapshot {
  totals: DashboardTotals;
  workspaces: DashboardWorkspaceSummary[];
  curriculums: DashboardCurriculumSummary[];
  upNextConcepts: DashboardConceptItem[];
  recentQuizzes: DashboardQuizItem[];
}

export function diversifyUpNextConcepts(
  items: DashboardConceptItem[],
  topCount: number = 3
): DashboardConceptItem[] {
  if (items.length <= 1) return items;
  const picked: DashboardConceptItem[] = [];
  const seenWorkspaces = new Set<string>();
  const remaining: DashboardConceptItem[] = [];

  for (const item of items) {
    if (picked.length < topCount && !seenWorkspaces.has(item.workspace_id)) {
      picked.push(item);
      seenWorkspaces.add(item.workspace_id);
    } else {
      remaining.push(item);
    }
  }

  return [...picked, ...remaining];
}

export async function getGlobalDueFlashcardCount(
  nowMs: number = Date.now()
): Promise<number> {
  const db = await getDb();
  const rows = await db.select<Array<{ dueFlashcardCount: number }>>(
    `SELECT COALESCE(COUNT(f.id), 0) AS dueFlashcardCount
     FROM flashcards f
     JOIN nodes n ON n.id = f.node_id
     JOIN workspaces w ON w.id = n.workspace_id
     WHERE w.archived_at IS NULL
       AND n.archived_at IS NULL
       AND f.next_review_at <= $1`,
    [nowMs]
  );
  return Number(rows[0]?.dueFlashcardCount ?? 0);
}

export async function getDashboardSnapshot(
  nowMs: number = Date.now()
): Promise<DashboardSnapshot> {
  const db = await getDb();
  const nowDate = new Date(nowMs);
  const startOfTodayMs = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate()
  ).getTime();

  const workspaceRows = await db.select<
    Array<{
      id: string;
      title: string;
      root_domain: string;
      updated_at: number;
      nodeCount: number;
      masteredCount: number;
      inProgressCount: number;
      unlockedCount: number;
      dueFlashcardCount: number;
    }>
  >(
    `SELECT
       w.id,
       w.title,
       w.root_domain,
       w.updated_at,
       COUNT(n.id) AS nodeCount,
       COALESCE(SUM(CASE WHEN n.status = 'mastered' THEN 1 ELSE 0 END), 0) AS masteredCount,
       COALESCE(SUM(CASE WHEN n.status = 'in_progress' THEN 1 ELSE 0 END), 0) AS inProgressCount,
       COALESCE(SUM(CASE WHEN n.status = 'unlocked' THEN 1 ELSE 0 END), 0) AS unlockedCount,
       (
         SELECT COUNT(*)
         FROM flashcards f
         JOIN nodes fn ON fn.id = f.node_id
         WHERE fn.workspace_id = w.id
           AND fn.archived_at IS NULL
           AND f.next_review_at <= $1
       ) AS dueFlashcardCount
     FROM workspaces w
     LEFT JOIN nodes n
       ON n.workspace_id = w.id
      AND n.archived_at IS NULL
     WHERE w.archived_at IS NULL
     GROUP BY w.id
     ORDER BY w.updated_at DESC`,
    [nowMs]
  );

  const rawUpNextConcepts = await db.select<DashboardConceptItem[]>(
    `SELECT
       n.id,
       n.workspace_id,
       w.title AS workspace_title,
       n.title,
       n.summary_hint,
       n.status,
       n.updated_at
     FROM nodes n
     JOIN workspaces w ON w.id = n.workspace_id
     WHERE w.archived_at IS NULL
       AND n.archived_at IS NULL
       AND n.status IN ('in_progress', 'unlocked')
     ORDER BY
       CASE WHEN n.status = 'in_progress' THEN 0 ELSE 1 END ASC,
       w.updated_at DESC,
       n.layer_index ASC,
       n.updated_at DESC
     LIMIT 24`
  );
  const upNextConcepts = diversifyUpNextConcepts(rawUpNextConcepts, 3);

  const curriculumRows = await db.select<
    Array<{
      id: string;
      title: string;
      subject_count: number;
      linked_count: number;
      nodeCount: number;
      masteredCount: number;
      updated_at: number;
    }>
  >(
    `SELECT
       t.id,
       t.title,
       COUNT(DISTINCT ctn.id) AS subject_count,
       COUNT(DISTINCT CASE WHEN w.id IS NOT NULL THEN ctn.id END) AS linked_count,
       COUNT(n.id) AS nodeCount,
       COALESCE(SUM(CASE WHEN n.status = 'mastered' THEN 1 ELSE 0 END), 0) AS masteredCount,
       t.updated_at
     FROM curriculum_trees t
     LEFT JOIN curriculum_tree_nodes ctn ON ctn.tree_id = t.id
     LEFT JOIN workspaces w
       ON w.id = ctn.workspace_id
      AND w.archived_at IS NULL
     LEFT JOIN nodes n
       ON n.workspace_id = w.id
      AND n.archived_at IS NULL
     WHERE t.archived_at IS NULL
     GROUP BY t.id
     ORDER BY t.updated_at DESC`
  );

  const recentQuizzes = await db.select<DashboardQuizItem[]>(
    `SELECT
       q.node_id,
       n.workspace_id,
       w.title AS workspace_title,
       n.title AS node_title,
       q.score,
       q.best_score,
       q.attempt_count,
       q.updated_at
     FROM node_quizzes q
     JOIN nodes n ON n.id = q.node_id
     JOIN workspaces w ON w.id = n.workspace_id
     WHERE w.archived_at IS NULL
       AND n.archived_at IS NULL
       AND q.attempt_count > 0
     ORDER BY q.updated_at DESC
     LIMIT 6`
  );

  const flashcardStatsRows = await db.select<
    Array<{
      flashcardCount: number;
      dueFlashcardCount: number;
      overdueFlashcardCount: number;
      dueTodayFlashcardCount: number;
    }>
  >(
    `SELECT
       COUNT(f.id) AS flashcardCount,
       COALESCE(SUM(CASE WHEN f.next_review_at <= $1 THEN 1 ELSE 0 END), 0) AS dueFlashcardCount,
       COALESCE(SUM(CASE WHEN f.next_review_at < $2 THEN 1 ELSE 0 END), 0) AS overdueFlashcardCount,
       COALESCE(SUM(CASE WHEN f.next_review_at >= $2 AND f.next_review_at <= $1 THEN 1 ELSE 0 END), 0) AS dueTodayFlashcardCount
     FROM flashcards f
     JOIN nodes n ON n.id = f.node_id
     JOIN workspaces w ON w.id = n.workspace_id
     WHERE w.archived_at IS NULL
       AND n.archived_at IS NULL`,
    [nowMs, startOfTodayMs]
  );

  const quizStatsRows = await db.select<
    Array<{
      quizCount: number;
      avgScore: number | null;
    }>
  >(
    `SELECT
       COUNT(q.node_id) AS quizCount,
       AVG(COALESCE(q.score, q.best_score)) AS avgScore
     FROM node_quizzes q
     JOIN nodes n ON n.id = q.node_id
     JOIN workspaces w ON w.id = n.workspace_id
     WHERE w.archived_at IS NULL
       AND n.archived_at IS NULL
       AND q.attempt_count > 0`
  );

  const totals = workspaceRows.reduce<DashboardTotals>(
    (acc, ws) => {
      const nodeCount = Number(ws.nodeCount ?? 0);
      const masteredCount = Number(ws.masteredCount ?? 0);
      const inProgressCount = Number(ws.inProgressCount ?? 0);
      const unlockedCount = Number(ws.unlockedCount ?? 0);
      acc.workspaceCount += 1;
      acc.nodeCount += nodeCount;
      acc.masteredCount += masteredCount;
      acc.inProgressCount += inProgressCount;
      acc.unlockedCount += unlockedCount;
      acc.lockedCount += Math.max(
        0,
        nodeCount - masteredCount - inProgressCount - unlockedCount
      );
      return acc;
    },
    {
      workspaceCount: 0,
      curriculumCount: curriculumRows.length,
      nodeCount: 0,
      masteredCount: 0,
      inProgressCount: 0,
      unlockedCount: 0,
      lockedCount: 0,
      flashcardCount: Number(flashcardStatsRows[0]?.flashcardCount ?? 0),
      dueFlashcardCount: Number(flashcardStatsRows[0]?.dueFlashcardCount ?? 0),
      overdueFlashcardCount: Number(
        flashcardStatsRows[0]?.overdueFlashcardCount ?? 0
      ),
      dueTodayFlashcardCount: Number(
        flashcardStatsRows[0]?.dueTodayFlashcardCount ?? 0
      ),
      quizCount: Number(quizStatsRows[0]?.quizCount ?? 0),
      averageQuizScore:
        quizStatsRows[0]?.avgScore !== null &&
        quizStatsRows[0]?.avgScore !== undefined
          ? Math.round(Number(quizStatsRows[0].avgScore) * 100)
          : null,
    }
  );

  return {
    totals,
    workspaces: workspaceRows,
    curriculums: curriculumRows,
    upNextConcepts,
    recentQuizzes,
  };
}

export function buildDashboardContextSummary(
  snapshot: DashboardSnapshot,
  reviewsCompletedToday: number,
  dailyReviewLimit: number
): string {
  const { totals, workspaces, curriculums, upNextConcepts, recentQuizzes } =
    snapshot;
  const masteryPct =
    totals.nodeCount > 0
      ? Math.round((totals.masteredCount / totals.nodeCount) * 100)
      : 0;
  const reviewGoal =
    dailyReviewLimit > 0
      ? `${reviewsCompletedToday}/${dailyReviewLimit}`
      : `${reviewsCompletedToday}`;
  const lines: string[] = [
    "Study Dashboard Overview:",
    `- Workspaces: ${totals.workspaceCount} active; Curriculum maps: ${totals.curriculumCount}`,
    `- Concepts: ${totals.masteredCount}/${totals.nodeCount} mastered (${masteryPct}%), ${totals.inProgressCount} in progress, ${totals.unlockedCount} ready to study, ${totals.lockedCount} locked`,
    `- Flashcards: ${totals.dueFlashcardCount} due now (${totals.flashcardCount} total); reviews today: ${reviewGoal}`,
    totals.averageQuizScore !== null
      ? `- Quizzes: ${totals.quizCount} completed, average score ${totals.averageQuizScore}%`
      : "- Quizzes: none completed yet",
  ];

  if (upNextConcepts.length > 0) {
    lines.push("Up next concepts:");
    for (const item of upNextConcepts.slice(0, 5)) {
      lines.push(
        `  - ${item.title} [${item.workspace_title}] (${
          item.status === "in_progress" ? "in progress" : "ready"
        })`
      );
    }
  }

  if (workspaces.length > 0) {
    lines.push("Active workspaces:");
    for (const ws of workspaces.slice(0, 5)) {
      lines.push(
        `  - ${ws.title}: ${ws.masteredCount}/${ws.nodeCount} mastered, ${ws.dueFlashcardCount} due cards`
      );
    }
  }

  if (curriculums.length > 0) {
    lines.push("Curriculum maps:");
    for (const tree of curriculums.slice(0, 4)) {
      lines.push(
        `  - ${tree.title}: ${tree.linked_count}/${tree.subject_count} subjects linked, ${tree.masteredCount}/${tree.nodeCount} concepts mastered`
      );
    }
  }

  if (recentQuizzes.length > 0) {
    lines.push("Recent quiz scores:");
    for (const quiz of recentQuizzes.slice(0, 4)) {
      const pct = Math.round((quiz.score ?? quiz.best_score) * 100);
      lines.push(`  - ${quiz.node_title} [${quiz.workspace_title}]: ${pct}%`);
    }
  }

  return lines.join("\n");
}
