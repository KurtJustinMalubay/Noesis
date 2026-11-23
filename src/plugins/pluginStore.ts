import { create } from "zustand";
import {
  BUILT_IN_PLUGINS,
  FLASHCARDS_PLUGIN_ID,
  isBuiltInPluginId,
} from "./registry.ts";
import type { BuiltInPluginId } from "./registry.ts";

const STORAGE_KEY = "noesis.plugins.v2";
const LEGACY_STORAGE_KEY = "noesis.plugins.v1";

function loadEnabledPluginIds(): BuiltInPluginId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseEnabledPluginIds(raw);

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) return getDefaultEnabledPluginIds();

    const legacyEnabledIds = parseEnabledPluginIds(legacyRaw);
    const migratedIds = new Set<BuiltInPluginId>(legacyEnabledIds);
    const newlyAddedDefaults: BuiltInPluginId[] = [FLASHCARDS_PLUGIN_ID];
    for (const pluginId of newlyAddedDefaults) {
      const plugin = BUILT_IN_PLUGINS.find((item) => item.id === pluginId);
      if (plugin?.defaultEnabled) migratedIds.add(pluginId);
    }

    const migrated = [...migratedIds];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return getDefaultEnabledPluginIds();
  }
}

function getDefaultEnabledPluginIds(): BuiltInPluginId[] {
  return BUILT_IN_PLUGINS.filter((plugin) => plugin.defaultEnabled).map(
    (plugin) => plugin.id
  );
}

function parseEnabledPluginIds(raw: string): BuiltInPluginId[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (value): value is BuiltInPluginId =>
      typeof value === "string" && isBuiltInPluginId(value)
  );
}

interface PluginState {
  enabledPluginIds: BuiltInPluginId[];
  setEnabledPluginIds: (pluginIds: string[]) => void;
  setPluginEnabled: (pluginId: string, enabled: boolean) => void;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  enabledPluginIds: loadEnabledPluginIds(),
  setEnabledPluginIds: (pluginIds) => {
    const next: BuiltInPluginId[] = [];
    for (const pluginId of new Set(pluginIds)) {
      if (!isBuiltInPluginId(pluginId)) {
        throw new Error(`Unknown built-in plugin: ${pluginId}`);
      }
      next.push(pluginId);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set({ enabledPluginIds: next });
  },
  setPluginEnabled: (pluginId, enabled) => {
    if (!isBuiltInPluginId(pluginId)) {
      throw new Error(`Unknown built-in plugin: ${pluginId}`);
    }

    const enabledPluginIds = new Set(get().enabledPluginIds);
    if (enabled) enabledPluginIds.add(pluginId);
    else enabledPluginIds.delete(pluginId);
    get().setEnabledPluginIds([...enabledPluginIds]);
  },
}));
