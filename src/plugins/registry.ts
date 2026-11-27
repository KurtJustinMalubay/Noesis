export const EXCALIDRAW_PLUGIN_ID = "excalidraw";
export const FLASHCARDS_PLUGIN_ID = "flashcards";
export const KOKORO_TTS_PLUGIN_ID = "kokoro-tts";
export const AI_USAGE_PLUGIN_ID = "ai-usage";
export const STUDY_CALENDAR_PLUGIN_ID = "study-calendar";

export const BUILT_IN_PLUGINS = [
  {
    id: EXCALIDRAW_PLUGIN_ID,
    name: "Excalidraw",
    description:
      "Create visual boards for a workspace or individual concept nodes.",
    defaultEnabled: true,
  },
  {
    id: FLASHCARDS_PLUGIN_ID,
    name: "Flashcards",
    description:
      "Generate, edit, and review lesson cards. Disabling hides these tools but keeps saved cards.",
    defaultEnabled: true,
  },
  {
    id: KOKORO_TTS_PLUGIN_ID,
    name: "Kokoro Voice (Neural TTS)",
    description:
      "Optional offline neural voice for reading lessons, tutor replies, and quizzes. Voice models (~95 MB) are downloaded separately in Settings → Voice & Audio.",
    defaultEnabled: false,
  },
  {
    id: AI_USAGE_PLUGIN_ID,
    name: "AI Usage",
    description:
      "Show this month's local AI request and token totals on the dashboard. Usage tracking stays on this device.",
    defaultEnabled: true,
  },
  {
    id: STUDY_CALENDAR_PLUGIN_ID,
    name: "Study Calendar",
    description:
      "Plan exams, deadlines, quizzes, and study sessions in a local calendar. Disabled by default.",
    defaultEnabled: false,
  },
] as const;

export type BuiltInPluginId = (typeof BUILT_IN_PLUGINS)[number]["id"];

export function isBuiltInPluginId(value: string): value is BuiltInPluginId {
  return BUILT_IN_PLUGINS.some((plugin) => plugin.id === value);
}
