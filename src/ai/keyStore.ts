export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  fastModel: string;
  synthesisModel: string;
  creativityPreset: "focused" | "balanced" | "exploratory";
  localBaseUrl: string;
  localModel: string;
  localContextWindowTokens: number;
  localMaxOutputTokens: number;
  localTemperature: number;
  localTopP: number;
}

export type AiProvider = "gemini" | "openai-compatible";
export const LOCAL_CONTEXT_WINDOW_MIN = 1024;
export const LOCAL_CONTEXT_WINDOW_MAX = 131072;
export const LOCAL_OUTPUT_TOKENS_MIN = 128;
export const LOCAL_OUTPUT_TOKENS_MAX = 32768;

export const GEMINI_MODEL_OPTIONS = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite · Ultra-light" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash · Deep synthesis" },
  { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen · Recommended fast reasoning" },
  { id: "gemini-4-argon", label: "Gemini 4 Argon" },
  { id: "gemini-4-neon", label: "Gemini 4 Neon" },
  { id: "gemini-4-carbon", label: "Gemini 4 Carbon · Reasoning" },
] as const;

export type AppTheme =
  | "daylight"
  | "mica-dark"
  | "warm-paper"
  | "nordic-frost"
  | "sage-studio";

const STORAGE_KEY = "noesis.ai.settings.v1";
const PREFERENCES_STORAGE_KEY = "noesis.preferences.v1";
const REVIEW_COUNT_PREFIX = "noesis.review-count.";

const DEFAULT_SETTINGS: AiSettings = {
  provider: "gemini",
  apiKey: "",
  fastModel: "gemini-4-hydrogen",
  synthesisModel: "gemini-3.5-flash-lite",
  creativityPreset: "balanced",
  localBaseUrl: "http://localhost:11434/v1",
  localModel: "",
  localContextWindowTokens: 2048,
  localMaxOutputTokens: 1200,
  localTemperature: 0.4,
  localTopP: 0.9,
};

export interface UserPreferences {
  theme: AppTheme;
  showCanvasDots: boolean;
  edgeRouting: "curved" | "orthogonal";
  nodeDensity: "comfortable" | "compact";
  masteryPassThreshold: 70 | 80 | 90;
  dailyReviewLimit: 10 | 20 | 40 | 0;
  showAppTutorial: boolean;
  launchInFullscreen: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "daylight",
  showCanvasDots: true,
  edgeRouting: "curved",
  nodeDensity: "comfortable",
  masteryPassThreshold: 80,
  dailyReviewLimit: 20,
  showAppTutorial: true,
  launchInFullscreen: false,
};

const APP_THEMES: AppTheme[] = [
  "daylight",
  "mica-dark",
  "warm-paper",
  "nordic-frost",
  "sage-studio",
];

function loadModelPreference(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const model = value.trim();
  return model.startsWith("gemini-2.5-") ? fallback : model;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function getLocalDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      provider:
        parsed.provider === "openai-compatible"
          ? "openai-compatible"
          : "gemini",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      fastModel: loadModelPreference(
        parsed.fastModel,
        DEFAULT_SETTINGS.fastModel
      ),
      synthesisModel: loadModelPreference(
        parsed.synthesisModel,
        DEFAULT_SETTINGS.synthesisModel
      ),
      creativityPreset:
        parsed.creativityPreset === "focused" ||
        parsed.creativityPreset === "exploratory"
          ? parsed.creativityPreset
          : "balanced",
      localBaseUrl:
        typeof parsed.localBaseUrl === "string" && parsed.localBaseUrl.trim()
          ? parsed.localBaseUrl.trim()
          : DEFAULT_SETTINGS.localBaseUrl,
      localModel:
        typeof parsed.localModel === "string" ? parsed.localModel.trim() : "",
      localContextWindowTokens: boundedInteger(
        parsed.localContextWindowTokens,
        LOCAL_CONTEXT_WINDOW_MIN,
        LOCAL_CONTEXT_WINDOW_MAX,
        DEFAULT_SETTINGS.localContextWindowTokens
      ),
      localMaxOutputTokens: boundedInteger(
        parsed.localMaxOutputTokens,
        LOCAL_OUTPUT_TOKENS_MIN,
        LOCAL_OUTPUT_TOKENS_MAX,
        DEFAULT_SETTINGS.localMaxOutputTokens
      ),
      localTemperature: boundedNumber(
        parsed.localTemperature,
        0,
        2,
        DEFAULT_SETTINGS.localTemperature
      ),
      localTopP: boundedNumber(
        parsed.localTopP,
        0,
        1,
        DEFAULT_SETTINGS.localTopP
      ),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      provider: settings.provider,
      apiKey: settings.apiKey.trim(),
      fastModel: settings.fastModel.trim() || DEFAULT_SETTINGS.fastModel,
      synthesisModel:
        settings.synthesisModel.trim() || DEFAULT_SETTINGS.synthesisModel,
      creativityPreset: settings.creativityPreset,
      localBaseUrl:
        settings.localBaseUrl.trim() || DEFAULT_SETTINGS.localBaseUrl,
      localModel: settings.localModel.trim(),
      localContextWindowTokens: boundedInteger(
        settings.localContextWindowTokens,
        LOCAL_CONTEXT_WINDOW_MIN,
        LOCAL_CONTEXT_WINDOW_MAX,
        DEFAULT_SETTINGS.localContextWindowTokens
      ),
      localMaxOutputTokens: boundedInteger(
        settings.localMaxOutputTokens,
        LOCAL_OUTPUT_TOKENS_MIN,
        LOCAL_OUTPUT_TOKENS_MAX,
        DEFAULT_SETTINGS.localMaxOutputTokens
      ),
      localTemperature: boundedNumber(
        settings.localTemperature,
        0,
        2,
        DEFAULT_SETTINGS.localTemperature
      ),
      localTopP: boundedNumber(
        settings.localTopP,
        0,
        1,
        DEFAULT_SETTINGS.localTopP
      ),
    })
  );
}

export function loadUserPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      theme:
        APP_THEMES.find((theme) => theme === parsed.theme) ??
        DEFAULT_PREFERENCES.theme,
      showCanvasDots:
        typeof parsed.showCanvasDots === "boolean"
          ? parsed.showCanvasDots
          : DEFAULT_PREFERENCES.showCanvasDots,
      edgeRouting:
        parsed.edgeRouting === "orthogonal" ? "orthogonal" : "curved",
      nodeDensity: parsed.nodeDensity === "compact" ? "compact" : "comfortable",
      masteryPassThreshold:
        parsed.masteryPassThreshold === 70 ||
        parsed.masteryPassThreshold === 90
          ? parsed.masteryPassThreshold
          : 80,
      dailyReviewLimit:
        parsed.dailyReviewLimit === 10 ||
        parsed.dailyReviewLimit === 40 ||
        parsed.dailyReviewLimit === 0
          ? parsed.dailyReviewLimit
          : 20,
      showAppTutorial:
        typeof parsed.showAppTutorial === "boolean"
          ? parsed.showAppTutorial
          : DEFAULT_PREFERENCES.showAppTutorial,
      launchInFullscreen:
        typeof parsed.launchInFullscreen === "boolean"
          ? parsed.launchInFullscreen
          : DEFAULT_PREFERENCES.launchInFullscreen,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveUserPreferences(preferences: UserPreferences): void {
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export function getReviewsCompletedToday(): number {
  const date = getLocalDateKey();
  const count = Number(
    localStorage.getItem(`${REVIEW_COUNT_PREFIX}${date}`) ?? 0
  );
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function recordCompletedReview(): number {
  const date = getLocalDateKey();
  const key = `${REVIEW_COUNT_PREFIX}${date}`;
  const count = getReviewsCompletedToday() + 1;
  localStorage.setItem(key, String(count));
  return count;
}

export function hasConfiguredApiKey(): boolean {
  const settings = loadAiSettings();
  return settings.provider === "openai-compatible"
    ? Boolean(settings.localModel.trim())
    : settings.apiKey.trim().length > 10;
}