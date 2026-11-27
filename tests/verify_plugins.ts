const values = new Map<string, string>([
  ["noesis.plugins.v2", JSON.stringify(["excalidraw"])],
]);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

const { usePluginStore } = await import("../src/plugins/pluginStore.ts");
const {
  AI_USAGE_PLUGIN_ID,
  BUILT_IN_PLUGINS,
  FLASHCARDS_PLUGIN_ID,
  STUDY_CALENDAR_PLUGIN_ID,
} = await import("../src/plugins/registry.ts");
if (
  BUILT_IN_PLUGINS.find((plugin) => plugin.id === STUDY_CALENDAR_PLUGIN_ID)
    ?.defaultEnabled !== false
) {
  throw new Error("Study Calendar should be disabled by default.");
}
const migratedIds = usePluginStore.getState().enabledPluginIds;
if (
  !migratedIds.includes(AI_USAGE_PLUGIN_ID) ||
  migratedIds.includes(FLASHCARDS_PLUGIN_ID) ||
  migratedIds.includes(STUDY_CALENDAR_PLUGIN_ID)
) {
  throw new Error(
    "Plugin migration should enable the new AI usage plugin without re-enabling disabled plugins or enabling Study Calendar."
  );
}

usePluginStore.getState().setPluginEnabled(AI_USAGE_PLUGIN_ID, false);
if (usePluginStore.getState().enabledPluginIds.includes(AI_USAGE_PLUGIN_ID)) {
  throw new Error("The AI usage plugin should be toggleable off.");
}
usePluginStore.getState().setPluginEnabled(AI_USAGE_PLUGIN_ID, true);
if (!usePluginStore.getState().enabledPluginIds.includes(AI_USAGE_PLUGIN_ID)) {
  throw new Error("The AI usage plugin should be toggleable on.");
}

console.log("✓ Built-in plugin migration and toggle tests passed!");
