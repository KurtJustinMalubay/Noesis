import {
  DEFAULT_PREFERENCES,
  loadUserPreferences,
} from "../src/ai/keyStore.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

let storedPreferences: string | null = null;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => storedPreferences,
    setItem: () => {},
  },
});

storedPreferences = null;
assert(
  loadUserPreferences().showAppTutorial === false,
  "new users should not be forced into the startup guide"
);
storedPreferences = JSON.stringify({ showAppTutorial: true });
assert(
  loadUserPreferences().showAppTutorial === true,
  "an explicit startup guide preference should be preserved"
);

storedPreferences = JSON.stringify({
  theme: "strawberry-daiquiri",
  appearanceMode: "dark",
  lastDarkThemeId: "tokyo-night",
  lastLightThemeId: "catppuccin-latte",
  fontFamily: "editorial",
  readingScale: "comfortable",
});
const darkPreferences = loadUserPreferences();
assert(
  darkPreferences.theme === "tokyo-night" &&
    darkPreferences.appearanceMode === "dark",
  "a persisted dark appearance must select a dark theme"
);
assert(
  darkPreferences.fontFamily === "editorial" &&
    darkPreferences.readingScale === "comfortable",
  "persisted font family and reading scale should load"
);

storedPreferences = JSON.stringify({
  theme: "midnight-dusk",
  appearanceMode: "light",
  lastLightThemeId: "lavender-mist",
});
const lightPreferences = loadUserPreferences();
assert(
  lightPreferences.theme === "lavender-mist" &&
    lightPreferences.appearanceMode === "light",
  "a persisted light appearance must select a light theme"
);

storedPreferences = JSON.stringify({
  theme: "nord-night",
  fontFamily: "unknown",
  readingScale: "large",
});
const migratedPreferences = loadUserPreferences();
assert(
  migratedPreferences.theme === "nord-night" &&
    migratedPreferences.appearanceMode === "dark" &&
    migratedPreferences.fontFamily === DEFAULT_PREFERENCES.fontFamily &&
    migratedPreferences.readingScale === DEFAULT_PREFERENCES.readingScale &&
    migratedPreferences.highContrastText ===
      DEFAULT_PREFERENCES.highContrastText,
  "legacy theme polarity should be inferred and invalid typography settings should fall back safely"
);
assert(
  migratedPreferences.showAppTutorial === false,
  "saved preferences without a guide setting should use the non-forcing default"
);
storedPreferences = JSON.stringify({ highContrastText: true });
assert(
  loadUserPreferences().highContrastText,
  "high-contrast text preference should load when enabled"
);

const pluginStorage = new Map<string, string>([
  ["noesis.plugins.v1", JSON.stringify([])],
]);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => pluginStorage.get(key) ?? null,
    setItem: (key: string, value: string) => pluginStorage.set(key, value),
  },
});
const { usePluginStore } = await import("../src/plugins/pluginStore.ts?migration-test");
const migratedPluginIds = usePluginStore.getState().enabledPluginIds;
assert(
  !migratedPluginIds.includes("excalidraw") &&
    migratedPluginIds.includes("flashcards"),
  "plugin migration should preserve existing choices and enable the new flashcards plugin by default"
);
usePluginStore.getState().setPluginEnabled("flashcards", false);
const reloadedPluginStore = await import("../src/plugins/pluginStore.ts?reload-test");
assert(
  !reloadedPluginStore.usePluginStore
    .getState()
    .enabledPluginIds.includes("flashcards"),
  "an explicitly disabled plugin should stay disabled after reload"
);

console.log("✓ Persisted theme and typography preference tests passed!");
