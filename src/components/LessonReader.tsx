import {
  useEffect,
  useRef,
  useState,
  type TransitionEvent,
} from "react";
import {
  Award,
  BookOpen,
  CheckCircle2,
  FileText,
  GraduationCap,
  X,
} from "lucide-react";
import type { GraphNode } from "../types/domain";
import type { AppTheme } from "../ai/keyStore";
import { RichContent } from "./ui/RichContent";

interface LessonReaderProps {
  node: GraphNode;
  theme: AppTheme;
  isOpen: boolean;
  companionOpen: boolean;
  isHydrating: boolean;
  hydrationError: string | null;
  hasSavedQuiz: boolean;
  isQuizAvailabilityLoaded: boolean;
  onClose: () => void;
  onRetryHydration: () => void;
  onRequestCompletion: (nodeId: string) => void;
  onStartDiagnostic: (nodeId: string) => void;
}

export function LessonReader({
  node,
  theme,
  isOpen,
  companionOpen,
  isHydrating,
  hydrationError,
  hasSavedQuiz,
  isQuizAvailabilityLoaded,
  onClose,
  onRetryHydration,
  onRequestCompletion,
  onStartDiagnostic,
}: LessonReaderProps) {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const mermaidRef = useRef<HTMLDivElement>(null);
  const [mermaidSvg, setMermaidSvg] = useState<string | null>(null);
  const [mermaidError, setMermaidError] = useState(false);
  const enterFramesRef = useRef<number[]>([]);
  const exitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    enterFramesRef.current.forEach((frame) => cancelAnimationFrame(frame));
    enterFramesRef.current = [];
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    if (isOpen) {
      setIsRendered(true);
      setIsVisible(false);
      const firstFrame = requestAnimationFrame(() => {
        const secondFrame = requestAnimationFrame(() => setIsVisible(true));
        enterFramesRef.current = [secondFrame];
      });
      enterFramesRef.current = [firstFrame];
    } else {
      setIsVisible(false);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setIsRendered(false);
      } else {
        exitTimerRef.current = window.setTimeout(
          () => setIsRendered(false),
          320
        );
      }
    }

    return () => {
      enterFramesRef.current.forEach((frame) => cancelAnimationFrame(frame));
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    let cancelled = false;
    async function renderDiagram() {
      if (!node.mermaid_diagram) {
        setMermaidSvg(null);
        setMermaidError(false);
        return;
      }
      setMermaidError(false);
      try {
        const { default: mermaid } = await import("mermaid");
        const themeRoot = document.querySelector<HTMLElement>("[data-theme]");
        const themeStyles = getComputedStyle(
          themeRoot ?? document.documentElement
        );
        const getToken = (name: string, fallback: string) =>
          themeStyles.getPropertyValue(name).trim() || fallback;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            background: getToken("--color-panel", "#ffffff"),
            primaryColor: getToken("--color-panel-subtle", "#edf4f6"),
            primaryTextColor: getToken("--color-ink", "#263b4a"),
            primaryBorderColor: getToken("--color-border-strong", "#b9cdd5"),
            lineColor: getToken("--color-accent", "#5e8294"),
            secondaryColor: getToken("--color-panel", "#f4f7f4"),
            tertiaryColor: getToken("--color-selected", "#fbf5e9"),
            fontFamily: "Inter, Segoe UI, sans-serif",
            fontSize: "13px",
          },
          securityLevel: "loose",
        });
        const cleanCode = node.mermaid_diagram
          .replace(/^```mermaid\s*/i, "")
          .replace(/```$/g, "")
          .trim();
        const id = `mermaid-${node.id.replace(/[^a-z0-9]/gi, "")}-${Date.now()}`;
        const { svg } = await mermaid.render(id, cleanCode);
        if (!cancelled) {
          setMermaidSvg(svg);
          setMermaidError(false);
        }
      } catch {
        if (!cancelled) {
          setMermaidSvg(null);
          setMermaidError(true);
        }
      }
    }
    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [node.id, node.mermaid_diagram, theme]);

  let citations: string[] = [];
  if (node.source_citations) {
    try {
      citations = JSON.parse(node.source_citations) as string[];
    } catch {
      citations = [];
    }
  }

  const handleTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
    if (
      isOpen ||
      event.target !== event.currentTarget ||
      event.propertyName !== "transform"
    ) {
      return;
    }
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setIsRendered(false);
  };

  if (!isRendered) return null;

  return (
    <aside
      onTransitionEnd={handleTransitionEnd}
      aria-hidden={!isOpen}
      inert={!isOpen}
      data-tutor-open={companionOpen}
      className={`lesson-reader-panel absolute inset-y-0 right-0 flex h-full max-w-full flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-panel)] shadow-[-12px_0_30px_rgba(35,51,60,0.12)] ${
        isVisible ? "lesson-reader-panel-visible" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-6 py-5">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-accent)]">
            <BookOpen className="h-3.5 w-3.5" />
            <span>Layer {node.layer_index + 1} / Module</span>
            {node.status === "mastered" && (
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-2 py-0.5 font-sans text-[9px] font-semibold normal-case tracking-normal text-[var(--color-success)]">
                Mastered
              </span>
            )}
          </div>
          <h2 className="mt-1.5 font-serif text-[21px] font-semibold leading-tight tracking-tight text-[var(--color-ink)]">
            {node.title}
          </h2>
          <p className="mt-1.5 max-w-[52ch] text-xs leading-5 text-[var(--color-muted)]">
            <RichContent inline>{node.summary_hint}</RichContent>
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
          aria-label="Close lesson"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto bg-[var(--color-panel)] px-6 py-6 select-text">
        {isHydrating ? (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
            <p className="mt-3 text-sm font-medium text-[var(--color-ink)]">
              Synthesizing First-Principles Lesson & Flashcards...
            </p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Grounding with local FTS5 vault excerpts
            </p>
          </div>
        ) : (
          <>
            {hydrationError && (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2.5 text-[11px]"
              >
                <p className="min-w-0 break-words text-[var(--color-ink)]">
                  Lesson generation failed: {hydrationError}
                </p>
                <button
                  type="button"
                  onClick={onRetryHydration}
                  className="shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1.5 font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
                >
                  Retry
                </button>
              </div>
            )}
            {mermaidSvg && (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-4">
                <p className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                  Concept Architecture
                </p>
                <div
                  ref={mermaidRef}
                  className="mermaid-wrap flex justify-center overflow-x-auto [&_svg]:max-h-[260px]"
                  dangerouslySetInnerHTML={{ __html: mermaidSvg }}
                />
              </div>
            )}
            {mermaidError && (
              <p className="rounded-lg border border-[#eadfda] bg-[#fcf7f5] px-3 py-2 text-[11px] text-[#805141]">
                The concept diagram could not be rendered. The lesson text is still available.
              </p>
            )}

            <RichContent className="prose prose-sm max-w-[72ch] select-text">
              {node.lesson_markdown ?? "_No lesson content generated yet._"}
            </RichContent>

            {citations.length > 0 && (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
                  <FileText className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                  <span>Local Vault Citations</span>
                </div>
                <ul className="mt-2 space-y-1.5 text-xs text-[var(--color-muted)]">
                  {citations.map((c, idx) => (
                    <li key={idx} className="truncate">
                      • {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-4">
        <button
          disabled={isHydrating || !isQuizAvailabilityLoaded}
          onClick={() => onStartDiagnostic(node.id)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-panel)] px-3 py-2.5 text-[11px] font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-hover)] disabled:opacity-50"
        >
          {hasSavedQuiz ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <GraduationCap className="h-4 w-4" />
          )}
          {!isQuizAvailabilityLoaded
            ? "Checking Quiz..."
            : hasSavedQuiz
              ? "Answer Quiz"
              : "Generate Quiz"}
        </button>

        <button
          disabled={isHydrating || node.status === "mastered"}
          onClick={() => onRequestCompletion(node.id)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-success)] px-3 py-2.5 text-[11px] font-semibold text-[var(--color-panel)] transition hover:brightness-95 disabled:cursor-default disabled:border disabled:border-[var(--color-border)] disabled:bg-[var(--color-panel)] disabled:text-[var(--color-success)]"
        >
          {node.status === "mastered" ? (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Mastered
            </>
          ) : (
            <>
              <Award className="h-4 w-4" />
              Complete & Unlock Next
            </>
          )}
        </button>
      </div>
    </aside>
  );
}