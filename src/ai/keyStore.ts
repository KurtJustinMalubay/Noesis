export type OpenAiCompatiblePresetId =
  | "openai"
  | "openrouter"
  | "groq"
  | "deepseek"
  | "ollama"
  | "lmstudio"
  | "foundry"
  | "custom";

export interface OpenAiCompatiblePreset {
  id: OpenAiCompatiblePresetId;
  label: string;
  kind: "cloud" | "local" | "custom";
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  defaultContextWindowTokens: number;
  defaultMaxOutputTokens: number;
  placeholderFastModel: string;
  placeholderSynthesisModel: string;
  keyUrl?: string;
  hint?: string;
}

export const OPENAI_COMPATIBLE_PRESETS: readonly OpenAiCompatiblePreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "cloud",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    defaultContextWindowTokens: 65536,
    defaultMaxOutputTokens: 4096,
    placeholderFastModel: "gpt-4o-mini",
    placeholderSynthesisModel: "gpt-4o",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "cloud",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    defaultContextWindowTokens: 65536,
    defaultMaxOutputTokens: 4096,
    placeholderFastModel: "openai/gpt-4o-mini",
    placeholderSynthesisModel: "anthropic/claude-3.5-sonnet",
    keyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "cloud",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    requiresApiKey: true,
    defaultContextWindowTokens: 32768,
    defaultMaxOutputTokens: 4096,
    placeholderFastModel: "llama-3.1-8b-instant",
    placeholderSynthesisModel: "llama-3.3-70b-versatile",
    keyUrl: "https://console.groq.com/keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "cloud",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    requiresApiKey: true,
    defaultContextWindowTokens: 65536,
    defaultMaxOutputTokens: 4096,
    placeholderFastModel: "deepseek-chat",
    placeholderSynthesisModel: "deepseek-reasoner",
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    kind: "local",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    defaultContextWindowTokens: 4096,
    defaultMaxOutputTokens: 2048,
    placeholderFastModel: "llama3.2",
    placeholderSynthesisModel: "qwen2.5:14b",
  },
  {
    id: "lmstudio",
    label: "LM Studio (Local)",
    kind: "local",
    defaultBaseUrl: "http://localhost:1234/v1",
    requiresApiKey: false,
    defaultContextWindowTokens: 4096,
    defaultMaxOutputTokens: 2048,
    placeholderFastModel: "local-model",
    placeholderSynthesisModel: "local-model",
  },
  {
    id: "foundry",
    label: "Foundry Local",
    kind: "local",
    defaultBaseUrl: "http://localhost:5272/v1",
    requiresApiKey: false,
    defaultContextWindowTokens: 4096,
    defaultMaxOutputTokens: 2048,
    placeholderFastModel: "phi-3.5-mini",
    placeholderSynthesisModel: "qwen2.5-7b",
    hint: "Run `foundry service status` to confirm your local service URL.",
  },
  {
    id: "custom",
    label: "Custom Endpoint",
    kind: "custom",
    defaultBaseUrl: "",
    requiresApiKey: false,
    defaultContextWindowTokens: 16384,
    defaultMaxOutputTokens: 2048,
    placeholderFastModel: "model-id",
    placeholderSynthesisModel: "model-id",
    hint: "Enter any OpenAI-compatible base URL (e.g. LiteLLM, vLLM, Together, or self-hosted).",
  },
] as const;

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  fastModel: string;
  synthesisModel: string;
  creativityPreset: "focused" | "balanced" | "exploratory";
  openAiPreset: OpenAiCompatiblePresetId;
  openAiApiKeys: Partial<Record<OpenAiCompatiblePresetId, string>>;
  openAiFastModel: string;
  openAiSynthesisModel: string;
  localBaseUrl: string;
  localModel: string;
  localContextWindowTokens: number;
  localMaxOutputTokens: number;
  localTemperature: number;
  localTopP: number;
  lessonDepth: "concise" | "standard" | "comprehensive";
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

export const APP_THEME_OPTIONS = [
  { id: "daylight", label: "Windows 11 Daylight", mode: "light", swatches: ["#f5f6f3", "#ffffff", "#326a9f"] },
  { id: "mica-dark", label: "Mica Dark", mode: "dark", swatches: ["#202020", "#2c2c2c", "#79b4ed"] },
  { id: "warm-paper", label: "Warm Paper", mode: "light", swatches: ["#f4efe5", "#fffaf0", "#765537"] },
  { id: "nordic-frost", label: "Nordic Frost", mode: "light", swatches: ["#edf2f5", "#fbfdff", "#3f6680"] },
  { id: "sage-studio", label: "Sage Studio", mode: "light", swatches: ["#eef1e8", "#fbfcf7", "#526a48"] },
  { id: "midnight-dusk", label: "Midnight Dusk", mode: "dark", swatches: ["#16151D", "#1F1E29", "#FF76A0"] },
  { id: "tako", label: "Tako", mode: "dark", swatches: ["#211F2E", "#2A273A", "#F3B375"] },
  { id: "nord-night", label: "Nord Night", mode: "dark", swatches: ["#242933", "#2E3440", "#88C0D0"] },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", mode: "dark", swatches: ["#1E1E2E", "#313244", "#CBA6F7"] },
  { id: "tokyo-night", label: "Tokyo Night", mode: "dark", swatches: ["#1A1B26", "#24283B", "#7AA2F7"] },
  { id: "amoled-obsidian", label: "AMOLED Obsidian", mode: "dark", swatches: ["#000000", "#161616", "#60A5FA"] },
  { id: "strawberry-daiquiri", label: "Strawberry Daiquiri", mode: "light", swatches: ["#FFF8F8", "#FFEBEE", "#B61E46"] },
  { id: "lavender-mist", label: "Lavender Mist", mode: "light", swatches: ["#F7F5FF", "#EDE7F6", "#6750A4"] },
  { id: "teal-turquoise", label: "Teal & Turquoise", mode: "light", swatches: ["#F4FBFB", "#E0F2F1", "#00695C"] },
  { id: "catppuccin-latte", label: "Catppuccin Latte", mode: "light", swatches: ["#EFF1F5", "#E6E9EF", "#4658AD"] },
] as const;

export type AppTheme = (typeof APP_THEME_OPTIONS)[number]["id"];
export type AppearanceMode = "dark" | "light";
export type FontFamily =
  | "system"
  | "geometric"
  | "editorial"
  | "hyperlegible"
  | "monospace";
export type ReadingScale = "compact" | "default" | "comfortable";

const STORAGE_KEY = "noesis.ai.settings.v1";
const PREFERENCES_STORAGE_KEY = "noesis.preferences.v1";
const REVIEW_COUNT_PREFIX = "noesis.review-count.";

const DEFAULT_SETTINGS: AiSettings = {
  provider: "gemini",
  apiKey: "",
  fastModel: "gemini-3.5-flash-lite",
  synthesisModel: "gemini-3.5-flash-lite",
  creativityPreset: "balanced",
  openAiPreset: "ollama",
  openAiApiKeys: {},
  openAiFastModel: "",
  openAiSynthesisModel: "",
  localBaseUrl: "http://localhost:11434/v1",
  localModel: "",
  localContextWindowTokens: 4096,
  localMaxOutputTokens: 2048,
  localTemperature: 0.4,
  localTopP: 0.9,
  lessonDepth: "standard",
};

export function getOpenAiPreset(
  presetId: OpenAiCompatiblePresetId | string | undefined
): OpenAiCompatiblePreset {
  return (
    OPENAI_COMPATIBLE_PRESETS.find((preset) => preset.id === presetId) ??
    OPENAI_COMPATIBLE_PRESETS[OPENAI_COMPATIBLE_PRESETS.length - 1]
  );
}

export function inferOpenAiPresetFromUrl(
  baseUrl: string
): OpenAiCompatiblePresetId {
  const normalized = baseUrl.trim().toLowerCase();
  if (!normalized) return "ollama";
  if (normalized.includes("api.openai.com")) return "openai";
  if (normalized.includes("openrouter.ai")) return "openrouter";
  if (normalized.includes("api.groq.com")) return "groq";
  if (normalized.includes("api.deepseek.com")) return "deepseek";
  if (normalized.includes(":11434")) return "ollama";
  if (normalized.includes(":1234")) return "lmstudio";
  if (normalized.includes(":5272")) return "foundry";
  return "custom";
}

export function getOpenAiApiKey(
  settings: Pick<AiSettings, "openAiPreset" | "openAiApiKeys">,
  presetId: OpenAiCompatiblePresetId = settings.openAiPreset
): string {
  return (settings.openAiApiKeys?.[presetId] ?? "").trim();
}

export const KOKORO_VOICE_OPTIONS = [
  { id: "af_heart", label: "Heart (US · Warm Female)" },
  { id: "af_bella", label: "Bella (US · Clear Female)" },
  { id: "af_nicole", label: "Nicole (US · Soft Female)" },
  { id: "af_sarah", label: "Sarah (US · Natural Female)" },
  { id: "af_sky", label: "Sky (US · Bright Female)" },
  { id: "am_adam", label: "Adam (US · Deep Male)" },
  { id: "am_michael", label: "Michael (US · Balanced Male)" },
  { id: "bf_emma", label: "Emma (UK · Clear Female)" },
  { id: "bf_isabella", label: "Isabella (UK · Warm Female)" },
  { id: "bm_george", label: "George (UK · Classic Male)" },
  { id: "bm_lewis", label: "Lewis (UK · Crisp Male)" },
] as const;

export type KokoroVoiceId = (typeof KOKORO_VOICE_OPTIONS)[number]["id"];

export interface UserPreferences {
  theme: AppTheme;
  appearanceMode: AppearanceMode;
  lastDarkThemeId: AppTheme;
  lastLightThemeId: AppTheme;
  fontFamily: FontFamily;
  readingScale: ReadingScale;
  highContrastText: boolean;
  showCanvasDots: boolean;
  edgeRouting: "curved" | "orthogonal";
  nodeDensity: "comfortable" | "compact";
  masteryPassThreshold: 70 | 80 | 90;
  dailyReviewLimit: 10 | 20 | 40 | 0;
  showAppTutorial: boolean;
  launchInFullscreen: boolean;
  reduceMotion: boolean;
  profileName: string;
  profileFocus: string;
  profilePromptSeen: boolean;
  kokoroVoice: KokoroVoiceId;
  kokoroSpeed: number;
  webSpeechRate: number;
  webSpeechPitch: number;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "daylight",
  appearanceMode: "light",
  lastDarkThemeId: "mica-dark",
  lastLightThemeId: "daylight",
  fontFamily: "system",
  readingScale: "default",
  highContrastText: false,
  showCanvasDots: true,
  edgeRouting: "curved",
  nodeDensity: "comfortable",
  masteryPassThreshold: 80,
  dailyReviewLimit: 20,
  showAppTutorial: false,
  launchInFullscreen: true,
  reduceMotion: false,
  profileName: "",
  profileFocus: "",
  profilePromptSeen: false,
  kokoroVoice: "af_heart",
  kokoroSpeed: 1,
  webSpeechRate: 1,
  webSpeechPitch: 1,
};

const DARK_THEMES = APP_THEME_OPTIONS.filter(({ mode }) => mode === "dark").map(
  ({ id }) => id
);
const LIGHT_THEMES = APP_THEME_OPTIONS.filter(({ mode }) => mode === "light").map(
  ({ id }) => id
);

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

function getLocalDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function sanitizeOpenAiApiKeys(
  raw: unknown
): Partial<Record<OpenAiCompatiblePresetId, string>> {
  if (!raw || typeof raw !== "object") return {};
  const result: Partial<Record<OpenAiCompatiblePresetId, string>> = {};
  const record = raw as Record<string, unknown>;
  for (const preset of OPENAI_COMPATIBLE_PRESETS) {
    const value = record[preset.id];
    if (typeof value === "string" && value.trim()) {
      result[preset.id] = value.trim();
    }
  }
  return result;
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    const localBaseUrl =
      typeof parsed.localBaseUrl === "string" && parsed.localBaseUrl.trim()
        ? parsed.localBaseUrl.trim()
        : DEFAULT_SETTINGS.localBaseUrl;
    const legacyLocalModel =
      typeof parsed.localModel === "string" ? parsed.localModel.trim() : "";
    const openAiFastModel =
      typeof parsed.openAiFastModel === "string" && parsed.openAiFastModel.trim()
        ? parsed.openAiFastModel.trim()
        : legacyLocalModel;
    const openAiSynthesisModel =
      typeof parsed.openAiSynthesisModel === "string" &&
      parsed.openAiSynthesisModel.trim()
        ? parsed.openAiSynthesisModel.trim()
        : openAiFastModel || legacyLocalModel;
    const hasValidPreset = OPENAI_COMPATIBLE_PRESETS.some(
      (preset) => preset.id === parsed.openAiPreset
    );
    const openAiPreset: OpenAiCompatiblePresetId = hasValidPreset
      ? (parsed.openAiPreset as OpenAiCompatiblePresetId)
      : inferOpenAiPresetFromUrl(localBaseUrl);
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
      openAiPreset,
      openAiApiKeys: sanitizeOpenAiApiKeys(parsed.openAiApiKeys),
      openAiFastModel,
      openAiSynthesisModel,
      localBaseUrl,
      localModel: openAiFastModel || legacyLocalModel,
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
      lessonDepth:
        parsed.lessonDepth === "concise" ||
        parsed.lessonDepth === "comprehensive"
          ? parsed.lessonDepth
          : "standard",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAiSettings(settings: AiSettings): void {
  const openAiFastModel =
    settings.openAiFastModel.trim() || settings.localModel.trim();
  const openAiSynthesisModel =
    settings.openAiSynthesisModel.trim() || openAiFastModel;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      provider: settings.provider,
      apiKey: settings.apiKey.trim(),
      fastModel: settings.fastModel.trim() || DEFAULT_SETTINGS.fastModel,
      synthesisModel:
        settings.synthesisModel.trim() || DEFAULT_SETTINGS.synthesisModel,
      creativityPreset: settings.creativityPreset,
      openAiPreset: settings.openAiPreset,
      openAiApiKeys: sanitizeOpenAiApiKeys(settings.openAiApiKeys),
      openAiFastModel,
      openAiSynthesisModel,
      localBaseUrl:
        settings.localBaseUrl.trim() || DEFAULT_SETTINGS.localBaseUrl,
      localModel: openAiFastModel,
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
      lessonDepth: settings.lessonDepth,
    })
  );
}

export function loadUserPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    const savedTheme = APP_THEME_OPTIONS.find(
      (option) => option.id === parsed.theme
    );
    const appearanceMode: AppearanceMode =
      parsed.appearanceMode === "dark" || parsed.appearanceMode === "light"
        ? parsed.appearanceMode
        : savedTheme?.mode === "dark"
          ? "dark"
          : "light";
    const lastDarkThemeId =
      DARK_THEMES.find((item) => item === parsed.lastDarkThemeId) ??
      (savedTheme?.mode === "dark"
        ? savedTheme.id
        : DEFAULT_PREFERENCES.lastDarkThemeId);
    const lastLightThemeId =
      LIGHT_THEMES.find((item) => item === parsed.lastLightThemeId) ??
      (savedTheme?.mode === "light"
        ? savedTheme.id
        : DEFAULT_PREFERENCES.lastLightThemeId);
    const theme =
      savedTheme?.mode === appearanceMode
        ? savedTheme.id
        : appearanceMode === "dark"
          ? lastDarkThemeId
          : lastLightThemeId;
    return {
      theme,
      appearanceMode,
      lastDarkThemeId,
      lastLightThemeId,
      fontFamily:
        parsed.fontFamily === "geometric" ||
        parsed.fontFamily === "editorial" ||
        parsed.fontFamily === "hyperlegible" ||
        parsed.fontFamily === "monospace"
          ? parsed.fontFamily
          : "system",
      readingScale:
        parsed.readingScale === "compact" || parsed.readingScale === "comfortable"
          ? parsed.readingScale
          : "default",
      highContrastText:
        typeof parsed.highContrastText === "boolean"
          ? parsed.highContrastText
          : DEFAULT_PREFERENCES.highContrastText,
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
      reduceMotion:
        typeof parsed.reduceMotion === "boolean"
          ? parsed.reduceMotion
          : DEFAULT_PREFERENCES.reduceMotion,
      profileName:
        typeof parsed.profileName === "string"
          ? parsed.profileName.slice(0, 80)
          : DEFAULT_PREFERENCES.profileName,
      profileFocus:
        typeof parsed.profileFocus === "string"
          ? parsed.profileFocus.slice(0, 120)
          : DEFAULT_PREFERENCES.profileFocus,
      profilePromptSeen:
        typeof parsed.profilePromptSeen === "boolean"
          ? parsed.profilePromptSeen
          : DEFAULT_PREFERENCES.profilePromptSeen,
      kokoroVoice: KOKORO_VOICE_OPTIONS.some(
        (voice) => voice.id === parsed.kokoroVoice
      )
        ? (parsed.kokoroVoice as KokoroVoiceId)
        : DEFAULT_PREFERENCES.kokoroVoice,
      kokoroSpeed: boundedNumber(
        parsed.kokoroSpeed,
        0.6,
        1.6,
        DEFAULT_PREFERENCES.kokoroSpeed
      ),
      webSpeechRate: boundedNumber(
        parsed.webSpeechRate,
        0.6,
        1.6,
        DEFAULT_PREFERENCES.webSpeechRate
      ),
      webSpeechPitch: boundedNumber(
        parsed.webSpeechPitch,
        0.6,
        1.5,
        DEFAULT_PREFERENCES.webSpeechPitch
      ),
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveUserPreferences(preferences: UserPreferences): void {
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export interface WeeklyConsistencyDay {
  label: string;
  dateKey: string;
  count: number;
  status: "completed" | "missed" | "today_pending" | "future";
}

const WEEKDAY_SHORT_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export function getWeeklyReviewConsistency(
  now: Date = new Date()
): WeeklyConsistencyDay[] {
  const mondayOffset = (now.getDay() + 6) % 7;
  return WEEKDAY_SHORT_LABELS.map((label, index) => {
    const targetDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - mondayOffset + index
    );
    const dateKey = getLocalDateKey(targetDate);
    const rawCount = Number(
      localStorage.getItem(`${REVIEW_COUNT_PREFIX}${dateKey}`) ?? 0
    );
    const count =
      Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0;
    const status: WeeklyConsistencyDay["status"] =
      index > mondayOffset
        ? "future"
        : count > 0
          ? "completed"
          : index === mondayOffset
            ? "today_pending"
            : "missed";
    return { label, dateKey, count, status };
  });
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
  if (settings.provider === "openai-compatible") {
    const hasModel = Boolean(
      settings.openAiFastModel.trim() ||
        settings.openAiSynthesisModel.trim() ||
        settings.localModel.trim()
    );
    const hasBaseUrl = Boolean(settings.localBaseUrl.trim());
    if (!hasModel || !hasBaseUrl) return false;
    const preset = getOpenAiPreset(settings.openAiPreset);
    return preset.requiresApiKey
      ? getOpenAiApiKey(settings).length > 0
      : true;
  }
  return settings.apiKey.trim().length > 10;
}