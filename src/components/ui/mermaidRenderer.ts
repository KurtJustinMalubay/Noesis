function resolveThemeColor(
  root: HTMLElement,
  name: string,
  fallback: string
): string {
  const probe = document.createElement("span");
  probe.style.color = getComputedStyle(root).getPropertyValue(name).trim() || fallback;
  if (!probe.style.color) return fallback;
  probe.style.display = "none";
  root.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const srgb = resolved.match(
    /^color\(srgb\s+([+-]?(?:\d*\.)?\d+)\s+([+-]?(?:\d*\.)?\d+)\s+([+-]?(?:\d*\.)?\d+)\s*\)$/i
  );
  if (!srgb) return resolved || fallback;
  return `#${srgb
    .slice(1, 4)
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, Number(channel))) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function getThemeVariables() {
  const root =
    document.querySelector<HTMLElement>(".app-shell[data-theme]") ??
    document.querySelector<HTMLElement>("[data-theme]") ??
    document.documentElement;
  return {
    background: resolveThemeColor(root, "--color-app-bg", "#f5f6f3"),
    primaryColor: resolveThemeColor(root, "--color-panel-subtle", "#edf4f6"),
    primaryTextColor: resolveThemeColor(root, "--color-ink", "#263b4a"),
    primaryBorderColor: resolveThemeColor(
      root,
      "--color-border-strong",
      "#b9cdd5"
    ),
    lineColor: resolveThemeColor(root, "--color-accent", "#5e8294"),
    secondaryColor: resolveThemeColor(root, "--color-panel", "#f4f7f4"),
    tertiaryColor: resolveThemeColor(root, "--color-selected", "#fbf5e9"),
    fontFamily:
      getComputedStyle(root).getPropertyValue("--font-ui").trim() ||
      "Inter, Segoe UI, sans-serif",
    fontSize: "13px",
  };
}

function getFallbackThemeVariables() {
  const theme = getThemeVariables();
  return {
    ...theme,
    secondaryTextColor: theme.primaryTextColor,
    tertiaryTextColor: theme.primaryTextColor,
    edgeLabelBackground: theme.background,
    clusterBkg: theme.background,
    clusterBorder: theme.primaryBorderColor,
  };
}

let renderQueue: Promise<void> = Promise.resolve();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function renderMermaidDiagram(code: string, id: string): Promise<string> {
  const result = renderQueue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: getThemeVariables(),
        securityLevel: "loose",
      });
      return (await mermaid.render(id, code)).svg;
    } catch (themeError) {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: getFallbackThemeVariables(),
          securityLevel: "loose",
        });
        return (await mermaid.render(`${id}-fallback`, code)).svg;
      } catch (fallbackError) {
        throw new Error(
          `Themed and fallback diagram rendering failed: ${getErrorMessage(
            themeError
          )}; ${getErrorMessage(fallbackError)}`
        );
      }
    }
  });
  renderQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
