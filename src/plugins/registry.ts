export const EXCALIDRAW_PLUGIN_ID = "excalidraw";

export const BUILT_IN_PLUGINS = [
  {
    id: EXCALIDRAW_PLUGIN_ID,
    name: "Excalidraw",
    description:
      "Create visual boards for a workspace or individual concept nodes.",
    defaultEnabled: true,
  },
] as const;

export type BuiltInPluginId = (typeof BUILT_IN_PLUGINS)[number]["id"];

export function isBuiltInPluginId(value: string): value is BuiltInPluginId {
  return BUILT_IN_PLUGINS.some((plugin) => plugin.id === value);
}
