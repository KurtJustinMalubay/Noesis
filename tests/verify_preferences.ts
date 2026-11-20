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
    migratedPreferences.readingScale === DEFAULT_PREFERENCES.readingScale,
  "legacy theme polarity should be inferred and invalid typography settings should fall back safely"
);

console.log("✓ Persisted theme and typography preference tests passed!");
