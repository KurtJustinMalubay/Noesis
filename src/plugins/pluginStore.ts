import { create } from "zustand";
import { BUILT_IN_PLUGINS, isBuiltInPluginId } from "./registry";
import type { BuiltInPluginId } from "./registry";

const STORAGE_KEY = "noesis.plugins.v1";

function loadEnabledPluginIds(): BuiltInPluginId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return BUILT_IN_PLUGINS.filter((plugin) => plugin.defaultEnabled).map(
        (plugin) => plugin.id
      );
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is BuiltInPluginId =>
        typeof value === "string" && isBuiltInPluginId(value)
    );
  } catch {
    return BUILT_IN_PLUGINS.filter((plugin) => plugin.defaultEnabled).map(
      (plugin) => plugin.id
    );
  }
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
