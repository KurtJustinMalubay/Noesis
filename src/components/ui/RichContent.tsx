import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathMarkdown } from "./normalizeMathMarkdown";

const INLINE_COMPONENTS: Components = {
  p: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
};

function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        const root = document.querySelector<HTMLElement>("[data-theme]");
        const styles = getComputedStyle(root ?? document.documentElement);
        const token = (name: string, fallback: string) =>
          styles.getPropertyValue(name).trim() || fallback;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            background: token("--color-panel", "#ffffff"),
            primaryColor: token("--color-panel-subtle", "#edf4f6"),
            primaryTextColor: token("--color-ink", "#263b4a"),
            primaryBorderColor: token("--color-border-strong", "#b9cdd5"),
            lineColor: token("--color-accent", "#5e8294"),
            fontFamily: token("--font-ui", "Inter, Segoe UI, sans-serif"),
          },
          securityLevel: "loose",
        });
        const id = `rich-mermaid-${crypto.randomUUID().replace(/-/g, "")}`;
        const rendered = await mermaid.render(id, code);
        if (active) {
          setSvg(rendered.svg);
          setFailed(false);
        }
      } catch {
        if (active) {
          setSvg(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [code]);

  if (svg) {
    return (
      <div
        className="my-4 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3 [&_svg]:mx-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  return (
    <pre className="my-3 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3">
      {failed && <span className="mb-2 block text-[10px] text-[var(--color-warning)]">Diagram could not be rendered.</span>}
      <code className="text-xs">{code}</code>
    </pre>
  );
}

const RICH_COMPONENTS: Components = {
  code: ({ className, children }) => {
    if (className?.split(/\s+/).includes("language-mermaid")) {
      return <MermaidBlock code={String(children).replace(/\n$/, "")} />;
    }
    return <code className={className}>{children}</code>;
  },
};

interface RichContentProps {
  children: string | null | undefined;
  className?: string;
  inline?: boolean;
}

export function RichContent({
  children,
  className,
  inline = false,
}: RichContentProps) {
  const markdown = useMemo(
    () => normalizeMathMarkdown(children ?? ""),
    [children]
  );
  const rendered = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [
          rehypeKatex,
          { throwOnError: false, strict: false, minRuleThickness: 0.06 },
        ],
      ]}
      components={inline ? INLINE_COMPONENTS : RICH_COMPONENTS}
    >
      {markdown}
    </ReactMarkdown>
  );

  return inline ? <>{rendered}</> : <div className={className}>{rendered}</div>;
}
