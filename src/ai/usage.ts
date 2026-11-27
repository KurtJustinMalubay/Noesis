export const AI_USAGE_UPDATED_EVENT = "noesis:ai-usage-updated";

const STORAGE_KEY = "noesis.ai-usage.v1";
const MAX_DAILY_ENTRIES = 400;

export type AiUsageFeature = "lessons" | "quizzes" | "tutor" | "other";

export interface AiUsageFeatureTotals {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiUsageTotals {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedRequestCount: number;
  byFeature?: Record<AiUsageFeature, AiUsageFeatureTotals>;
}

export interface AiUsageSummary {
  thisMonth: AiUsageTotals;
  allTime: AiUsageTotals;
}

interface StoredAiUsage {
  allTime: AiUsageTotals;
  daily: Record<string, AiUsageTotals>;
}

const emptyFeatureTotals = (): AiUsageFeatureTotals => ({
  requestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
});

const emptyByFeature = (): Record<AiUsageFeature, AiUsageFeatureTotals> => ({
  lessons: emptyFeatureTotals(),
  quizzes: emptyFeatureTotals(),
  tutor: emptyFeatureTotals(),
  other: emptyFeatureTotals(),
});

const emptyTotals = (): AiUsageTotals => ({
  requestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedRequestCount: 0,
  byFeature: emptyByFeature(),
});

let cachedUsage: StoredAiUsage | null = null;

export function estimateAiTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeTotals(value: unknown): AiUsageTotals {
  if (!isRecord(value)) return emptyTotals();
  const normalizeCount = (candidate: unknown) =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(0, Math.floor(candidate))
      : 0;
  const rawByFeature = isRecord(value.byFeature) ? value.byFeature : null;
  const byFeature = emptyByFeature();
  if (rawByFeature) {
    (["lessons", "quizzes", "tutor", "other"] as const).forEach((feature) => {
      const entry = rawByFeature[feature];
      if (isRecord(entry)) {
        byFeature[feature] = {
          requestCount: normalizeCount(entry.requestCount),
          inputTokens: normalizeCount(entry.inputTokens),
          outputTokens: normalizeCount(entry.outputTokens),
        };
      }
    });
  }
  return {
    requestCount: normalizeCount(value.requestCount),
    inputTokens: normalizeCount(value.inputTokens),
    outputTokens: normalizeCount(value.outputTokens),
    estimatedRequestCount: normalizeCount(value.estimatedRequestCount),
    byFeature,
  };
}

function readUsage(): StoredAiUsage {
  if (cachedUsage) return cachedUsage;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) {
        const daily: Record<string, AiUsageTotals> = {};
        if (isRecord(parsed.daily)) {
          for (const [date, totals] of Object.entries(parsed.daily)) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
              daily[date] = normalizeTotals(totals);
            }
          }
        }
        cachedUsage = {
          allTime: normalizeTotals(parsed.allTime),
          daily,
        };
        return cachedUsage;
      }
    }
  } catch (error) {
    console.warn("Unable to read local AI usage history.", error);
  }
  cachedUsage = { allTime: emptyTotals(), daily: {} };
  return cachedUsage;
}

function persistUsage(usage: StoredAiUsage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  } catch (error) {
    console.warn("Unable to save local AI usage history.", error);
  }
}

function getLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mergeByFeature(
  left?: Record<AiUsageFeature, AiUsageFeatureTotals>,
  right?: Record<AiUsageFeature, AiUsageFeatureTotals>
): Record<AiUsageFeature, AiUsageFeatureTotals> {
  const merged = emptyByFeature();
  (["lessons", "quizzes", "tutor", "other"] as const).forEach((feature) => {
    const a = left?.[feature];
    const b = right?.[feature];
    merged[feature] = {
      requestCount: (a?.requestCount ?? 0) + (b?.requestCount ?? 0),
      inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
      outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    };
  });
  return merged;
}

function addTotals(
  current: AiUsageTotals,
  addition: Omit<AiUsageTotals, "requestCount" | "estimatedRequestCount" | "byFeature"> & {
    isEstimated: boolean;
    feature?: AiUsageFeature;
  }
): AiUsageTotals {
  const feature: AiUsageFeature = addition.feature ?? "other";
  const nextByFeature = mergeByFeature(current.byFeature, undefined);
  nextByFeature[feature] = {
    requestCount: nextByFeature[feature].requestCount + 1,
    inputTokens: nextByFeature[feature].inputTokens + addition.inputTokens,
    outputTokens: nextByFeature[feature].outputTokens + addition.outputTokens,
  };
  return {
    requestCount: current.requestCount + 1,
    inputTokens: current.inputTokens + addition.inputTokens,
    outputTokens: current.outputTokens + addition.outputTokens,
    estimatedRequestCount:
      current.estimatedRequestCount + (addition.isEstimated ? 1 : 0),
    byFeature: nextByFeature,
  };
}

export function recordAiUsage(
  usage: {
    inputTokens: number;
    outputTokens: number;
    isEstimated: boolean;
    feature?: AiUsageFeature;
  },
  timestamp: number = Date.now()
): void {
  const stored = readUsage();
  const dateKey = getLocalDateKey(timestamp);
  stored.allTime = addTotals(stored.allTime, usage);
  stored.daily[dateKey] = addTotals(
    stored.daily[dateKey] ?? emptyTotals(),
    usage
  );

  const oldestAllowedDate = Date.now() - MAX_DAILY_ENTRIES * 86_400_000;
  for (const date of Object.keys(stored.daily)) {
    if (new Date(`${date}T00:00:00`).getTime() < oldestAllowedDate) {
      delete stored.daily[date];
    }
  }

  persistUsage(stored);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AI_USAGE_UPDATED_EVENT));
  }
}

export function getAiUsageSummary(
  now: number = Date.now()
): AiUsageSummary {
  const stored = readUsage();
  const monthPrefix = getLocalDateKey(now).slice(0, 7);
  const thisMonth = Object.entries(stored.daily).reduce(
    (totals, [date, dailyTotals]) => {
      if (!date.startsWith(monthPrefix)) return totals;
      return {
        requestCount: totals.requestCount + dailyTotals.requestCount,
        inputTokens: totals.inputTokens + dailyTotals.inputTokens,
        outputTokens: totals.outputTokens + dailyTotals.outputTokens,
        estimatedRequestCount:
          totals.estimatedRequestCount + dailyTotals.estimatedRequestCount,
        byFeature: mergeByFeature(totals.byFeature, dailyTotals.byFeature),
      };
    },
    emptyTotals()
  );
  return { thisMonth, allTime: { ...stored.allTime } };
}
