import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathMarkdown } from "./normalizeMathMarkdown";
import { renderMermaidDiagram } from "./mermaidRenderer";
import type { LessonMedia } from "./LessonMediaViewer";

const INLINE_COMPONENTS: Components = {
  p: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
};

function MermaidBlock({
  code,
  onOpenMedia,
}: {
  code: string;
  onOpenMedia?: (media: LessonMedia) => void;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [themeKey, setThemeKey] = useState(
    () =>
      document
        .querySelector<HTMLElement>(".app-shell[data-theme]")
        ?.getAttribute("data-theme") ?? ""
  );

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".app-shell[data-theme]");
    if (!root) return;
    const observer = new MutationObserver(() => {
      setThemeKey(root.getAttribute("data-theme") ?? "");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const id = `rich-mermaid-${crypto.randomUUID().replace(/-/g, "")}`;
        const rendered = await renderMermaidDiagram(code, id);
        if (active) {
          setSvg(rendered);
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
  }, [code, themeKey]);

  if (svg) {
    return (
      <div
        className="my-4 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3 [&_svg]:mx-auto [&_svg]:max-w-full"
      >
        {onOpenMedia ? (
          <button
            type="button"
            aria-label="Enlarge lesson diagram"
            title="Open diagram"
            onClick={() =>
              onOpenMedia({ kind: "diagram", svg, title: "Lesson diagram" })
            }
            className="block w-full cursor-zoom-in"
          >
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          </button>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </div>
    );
  }
  return (
    <pre className="my-3 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3">
      {failed && <span className="mb-2 block text-[10px] text-[var(--color-warning)]">Diagram could not be rendered.</span>}
      <code className="text-xs">{code}</code>
    </pre>
  );
}

interface RichContentProps {
  children: string | null | undefined;
  className?: string;
  inline?: boolean;
  onOpenMedia?: (media: LessonMedia) => void;
}

export function RichContent({
  children,
  className,
  inline = false,
  onOpenMedia,
}: RichContentProps) {
  const markdown = useMemo(
    () => normalizeMathMarkdown(children ?? ""),
    [children]
  );
  const richComponents = useMemo<Components>(
    () => ({
      code: ({ className: codeClassName, children: codeChildren }) => {
        if (codeClassName?.split(/\s+/).includes("language-mermaid")) {
          return (
            <MermaidBlock
              code={String(codeChildren).replace(/\n$/, "")}
              onOpenMedia={onOpenMedia}
            />
          );
        }
        return <code className={codeClassName}>{codeChildren}</code>;
      },
      img: ({ src, alt, title }) => {
        if (!src) return null;
        const image = (
          <img
            src={src}
            alt={alt ?? ""}
            title={title}
            loading="lazy"
            className="max-h-[420px] max-w-full cursor-zoom-in rounded-lg object-contain"
          />
        );
        if (!onOpenMedia) return image;
        return (
          <button
            type="button"
            aria-label={`Enlarge image${alt ? `: ${alt}` : ""}`}
            title="Open image"
            onClick={() =>
              onOpenMedia({
                kind: "image",
                src,
                alt: alt ?? "",
                title: title ?? undefined,
              })
            }
            className="my-2 inline-flex max-w-full cursor-zoom-in"
          >
            {image}
          </button>
        );
      },
    }),
    [onOpenMedia]
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
      components={inline ? INLINE_COMPONENTS : richComponents}
    >
      {markdown}
    </ReactMarkdown>
  );

  return inline ? <>{rendered}</> : <div className={className}>{rendered}</div>;
}
