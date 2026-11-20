import { useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathMarkdown } from "./normalizeMathMarkdown";

const INLINE_COMPONENTS: Components = {
  p: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
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
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      components={inline ? INLINE_COMPONENTS : undefined}
    >
      {markdown}
    </ReactMarkdown>
  );

  return inline ? <>{rendered}</> : <div className={className}>{rendered}</div>;
}
