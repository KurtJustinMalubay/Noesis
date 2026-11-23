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
  Copy,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Shapes,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { GraphNode } from "../types/domain";
import type { AppTheme } from "../ai/keyStore";
import {
  generateWorkedExample,
  type WorkedExampleTool,
} from "../ai/curriculumService";
import {
  deleteLessonExample,
  listLessonExamples,
  saveLessonExample,
  updateLessonExample,
  type LessonExample,
} from "../db/repositories/lessonExampleRepo";
import { RichContent } from "./ui/RichContent";
import { renderMermaidDiagram } from "./ui/mermaidRenderer";
import {
  LessonMediaViewer,
  type LessonMedia,
} from "./ui/LessonMediaViewer";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

const EXAMPLE_TOOLS: Array<{ id: WorkedExampleTool; label: string }> = [
  { id: "mermaid", label: "Mermaid Diagram / Automata Graph" },
  { id: "math", label: "Step-by-Step Math (KaTeX)" },
  { id: "code", label: "Code Walkthrough" },
  { id: "trace-table", label: "State / Trace Table" },
  { id: "analogy", label: "Real-World Analogy" },
  { id: "image", label: "Online Image / Illustration" },
];

function parseExampleTools(value: string): WorkedExampleTool[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (tool): tool is WorkedExampleTool =>
        tool === "mermaid" ||
        tool === "math" ||
        tool === "code" ||
        tool === "trace-table" ||
        tool === "analogy" ||
        tool === "image"
    );
  } catch {
    return [];
  }
}

interface LessonReaderProps {
  node: GraphNode;
  theme: AppTheme;
  isOpen: boolean;
  companionOpen: boolean;
  isHydrating: boolean;
  hydrationError: string | null;
  generationPreview: string;
  flashcardsEnabled: boolean;
  flashcardCount: number | null;
  isGeneratingFlashcards: boolean;
  hasSavedQuiz: boolean;
  isQuizAvailabilityLoaded: boolean;
  onClose: () => void;
  onRetryHydration: () => void;
  onRegenerateLesson: () => void;
  onGenerateFlashcards: () => void;
  onRequestCompletion: (nodeId: string) => void;
  onStartDiagnostic: (nodeId: string) => void;
  onOpenVisualBoard?: (node: GraphNode) => Promise<void>;
  onToast: (message: string) => void;
}

export function LessonReader({
  node,
  theme,
  isOpen,
  companionOpen,
  isHydrating,
  hydrationError,
  generationPreview,
  flashcardsEnabled,
  flashcardCount,
  isGeneratingFlashcards,
  hasSavedQuiz,
  isQuizAvailabilityLoaded,
  onClose,
  onRetryHydration,
  onRegenerateLesson,
  onGenerateFlashcards,
  onRequestCompletion,
  onStartDiagnostic,
  onOpenVisualBoard,
  onToast,
}: LessonReaderProps) {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const mermaidRef = useRef<HTMLDivElement>(null);
  const [mermaidSvg, setMermaidSvg] = useState<string | null>(null);
  const [mermaidError, setMermaidError] = useState(false);
  const [activeMedia, setActiveMedia] = useState<LessonMedia | null>(null);
  const [examples, setExamples] = useState<LessonExample[]>([]);
  const [exampleToDelete, setExampleToDelete] =
    useState<LessonExample | null>(null);
  const [isExampleComposerOpen, setIsExampleComposerOpen] = useState(false);
  const [examplePrompt, setExamplePrompt] = useState("");
  const [exampleTools, setExampleTools] = useState<WorkedExampleTool[]>([]);
  const [isRegenerationConfirmationOpen, setIsRegenerationConfirmationOpen] =
    useState(false);
  const [isGeneratingExample, setIsGeneratingExample] = useState(false);
  const [isOpeningVisualBoard, setIsOpeningVisualBoard] = useState(false);
  const [streamedExample, setStreamedExample] = useState("");
  const exampleAbortRef = useRef<AbortController | null>(null);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const enterFramesRef = useRef<number[]>([]);
  const enterFallbackRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) setExampleToDelete(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) setActiveMedia(null);
  }, [isOpen]);

  useEffect(() => {
    setIsRegenerationConfirmationOpen(false);
  }, [node.id]);

  useEffect(() => {
    enterFramesRef.current.forEach((frame) => cancelAnimationFrame(frame));
    enterFramesRef.current = [];
    if (enterFallbackRef.current !== null) {
      window.clearTimeout(enterFallbackRef.current);
      enterFallbackRef.current = null;
    }
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    if (isOpen) {
      setIsRendered(true);
      setIsVisible(false);
      if (typeof window.requestAnimationFrame === "function") {
        const firstFrame = window.requestAnimationFrame(() => {
          const secondFrame = window.requestAnimationFrame(() =>
            setIsVisible(true)
          );
          enterFramesRef.current = [secondFrame];
        });
        enterFramesRef.current = [firstFrame];
      }
      enterFallbackRef.current = window.setTimeout(
        () => setIsVisible(true),
        120
      );
    } else {
      setIsVisible(false);
      if (
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false
      ) {
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
      if (enterFallbackRef.current !== null) {
        window.clearTimeout(enterFallbackRef.current);
        enterFallbackRef.current = null;
      }
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    let active = true;
    setExamples([]);
    void listLessonExamples(node.id)
      .then((loaded) => {
        if (active) setExamples(loaded);
      })
      .catch((error: unknown) => {
        if (active) {
          onToastRef.current(
            error instanceof Error ? error.message : String(error)
          );
        }
      });
    return () => {
      active = false;
      exampleAbortRef.current?.abort();
    };
  }, [node.id]);

  const generateExample = async (existing?: LessonExample) => {
    const tools = existing ? parseExampleTools(existing.tools_json) : exampleTools;
    const prompt = existing?.user_prompt ?? examplePrompt;
    const id = existing?.id ?? crypto.randomUUID();
    const controller = new AbortController();
    exampleAbortRef.current = controller;
    setIsGeneratingExample(true);
    setStreamedExample("");
    try {
      const content = await generateWorkedExample(node, prompt, tools, {
        signal: controller.signal,
        onChunk: (chunk) => setStreamedExample((current) => current + chunk),
      });
      const record: LessonExample = {
        id,
        node_id: node.id,
        user_prompt: prompt,
        tools_json: JSON.stringify(tools),
        content_markdown: content,
        created_at: existing?.created_at ?? new Date().toISOString(),
      };
      if (existing) {
        await updateLessonExample(record);
        setExamples((current) =>
          current.map((item) => (item.id === id ? record : item))
        );
      } else {
        await saveLessonExample(record);
        setExamples((current) => [...current, record]);
        setExamplePrompt("");
        setExampleTools([]);
      }
      setStreamedExample("");
      setIsExampleComposerOpen(false);
      onToast(existing ? "Worked example regenerated." : "Worked example added.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        onToast(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (exampleAbortRef.current === controller) {
        exampleAbortRef.current = null;
        setIsGeneratingExample(false);
        setStreamedExample("");
      }
    }
  };

  const removeExample = async () => {
    if (!exampleToDelete) return;
    await deleteLessonExample(exampleToDelete.id);
    setExamples((current) =>
      current.filter((example) => example.id !== exampleToDelete.id)
    );
    onToast("Worked example deleted.");
  };

  const copyExample = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      onToast("Worked example copied.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    }
  };

  const mermaidCode = (node.mermaid_diagram ?? "")
    .replace(/^```mermaid\s*/i, "")
    .replace(/```$/g, "")
    .trim();

  const openVisualBoard = async () => {
    if (!onOpenVisualBoard || isOpeningVisualBoard) return;
    setIsOpeningVisualBoard(true);
    try {
      await onOpenVisualBoard(node);
    } catch (error) {
      onToast(
        `Could not open the visual board: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setIsOpeningVisualBoard(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function renderDiagram() {
      if (!mermaidCode) {
        setMermaidSvg(null);
        setMermaidError(false);
        return;
      }
      setMermaidError(false);
      try {
        const id = `mermaid-${node.id.replace(
          /[^a-z0-9]/gi,
          ""
        )}-${crypto.randomUUID().replace(/-/g, "")}`;
        const svg = await renderMermaidDiagram(mermaidCode, id);
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
  }, [node.id, mermaidCode, theme]);

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
        isExpanded ? "lesson-reader-panel-expanded" : ""
      } ${
        isVisible ? "lesson-reader-panel-visible" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-5 sm:px-6">
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
          <h2 className="mt-2 font-serif text-2xl font-semibold leading-tight tracking-tight text-[var(--color-ink)]">
            {node.title}
          </h2>
          <p className="mt-2 max-w-[52ch] text-[13px] leading-5 text-[var(--color-muted)]">
            <RichContent inline>{node.summary_hint}</RichContent>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onOpenVisualBoard && (
            <button
              type="button"
              onClick={() => void openVisualBoard()}
              disabled={isHydrating || isOpeningVisualBoard}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-wait disabled:opacity-50"
              aria-label="Open or create this lesson's visual board"
              title="Open or create this lesson's visual board"
            >
              <Shapes className="h-4 w-4" />
              <span>Visual board</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
            aria-label={isExpanded ? "Restore lesson panel size" : "Expand lesson panel"}
            aria-pressed={isExpanded}
            title={isExpanded ? "Restore panel size" : "Expand panel"}
          >
            {isExpanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
            aria-label="Close lesson"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className={`lesson-reader-content flex-1 space-y-6 overflow-y-auto bg-[var(--color-panel)] px-5 py-6 select-text sm:px-6 ${
          isExpanded ? "lesson-reader-content-expanded" : ""
        }`}
      >
        {isHydrating ? (
          <div className="flex min-h-64 flex-col items-center justify-center text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
            <p className="mt-3 text-sm font-medium text-[var(--color-ink)]">
              Generating lesson content...
            </p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Grounding with relevant local sources
            </p>
            {generationPreview && (
              <pre className="mt-5 max-h-[45vh] w-full max-w-2xl overflow-y-auto whitespace-pre-wrap rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-4 text-left font-sans text-sm leading-6 text-[var(--color-ink)]">
                {generationPreview}
              </pre>
            )}
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
                <button
                  type="button"
                  aria-label="Enlarge concept diagram"
                  title="Open diagram"
                  onClick={() =>
                    setActiveMedia({
                      kind: "diagram",
                      svg: mermaidSvg,
                      title: `${node.title} — Concept Architecture`,
                    })
                  }
                  className="mermaid-wrap flex w-full cursor-zoom-in justify-center overflow-x-auto [&_svg]:max-h-[260px]"
                >
                  <div
                    ref={mermaidRef}
                    dangerouslySetInnerHTML={{ __html: mermaidSvg }}
                  />
                </button>
              </div>
            )}
            {mermaidError && (
              <div
                role="alert"
                className="rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-[11px] text-[var(--color-ink)]"
              >
                <p>
                  The concept diagram could not be rendered, so its Mermaid
                  source is shown as a fallback.
                </p>
                <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3 font-mono text-[10px] leading-5 text-[var(--color-ink)]">
                  <code>{mermaidCode}</code>
                </pre>
              </div>
            )}

            {node.is_hydrated === 1 && (
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                  Lesson
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    setIsRegenerationConfirmationOpen((open) => !open)
                  }
                  disabled={isHydrating}
                  aria-expanded={isRegenerationConfirmationOpen}
                  aria-controls="lesson-regeneration-confirmation"
                  title="Replace the lesson, diagram, and references. Saved examples, quizzes, and study progress are kept."
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[11px] font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-hover)] disabled:cursor-wait disabled:opacity-50"
                  aria-label="Regenerate lesson"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate lesson
                </button>
              </div>
            )}
            {flashcardsEnabled && node.is_hydrated === 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--color-ink)]">
                    Optional study cards
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-muted)]">
                    Generate flashcards separately when you’re ready to review.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onGenerateFlashcards}
                  disabled={
                    isHydrating ||
                    isGeneratingFlashcards ||
                    flashcardCount === null ||
                    flashcardCount > 0
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[11px] font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGeneratingFlashcards ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : flashcardCount !== null && flashcardCount > 0 ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {isGeneratingFlashcards
                    ? "Generating…"
                    : flashcardCount === null
                      ? "Checking…"
                      : flashcardCount > 0
                        ? "Flashcards ready"
                        : "Generate flashcards"}
                </button>
              </div>
            )}
            {isRegenerationConfirmationOpen && (
              <div
                id="lesson-regeneration-confirmation"
                role="group"
                aria-label="Confirm lesson regeneration"
                className="space-y-3 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3"
              >
                <p className="text-xs leading-5 text-[var(--color-ink)]">
                  Regenerate this lesson? The lesson, diagram, and references
                  will be replaced. Worked examples, quizzes, and study
                  progress will be kept.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setIsRegenerationConfirmationOpen(false)
                    }
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsRegenerationConfirmationOpen(false);
                      onRegenerateLesson();
                    }}
                    className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-panel)] transition hover:brightness-95"
                  >
                    Confirm regenerate
                  </button>
                </div>
              </div>
            )}
            <RichContent
              className="prose lesson-prose prose-sm max-w-[72ch] select-text"
              onOpenMedia={setActiveMedia}
            >
              {node.lesson_markdown ?? "_No lesson content generated yet._"}
            </RichContent>

            <section className="space-y-3 border-t border-[var(--color-border)] pt-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                  Worked Examples
                </h3>
                <button
                  type="button"
                  onClick={() => setIsExampleComposerOpen((open) => !open)}
                  disabled={isGeneratingExample}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[11px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-hover)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Generate Example
                </button>
              </div>
              {isExampleComposerOpen && (
                <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3">
                  <label className="block text-[11px] font-semibold">
                    Scenario / focus
                    <textarea
                      value={examplePrompt}
                      onChange={(event) => setExamplePrompt(event.target.value)}
                      placeholder="e.g., Trace a DFA accepting strings with an even number of 0s, or leave blank for an automatic example..."
                      disabled={isGeneratingExample}
                      className="mt-1.5 min-h-16 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs font-normal text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {EXAMPLE_TOOLS.map((tool) => {
                      const selected = exampleTools.includes(tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          aria-pressed={selected}
                          disabled={isGeneratingExample}
                          onClick={() =>
                            setExampleTools((current) =>
                              selected
                                ? current.filter((item) => item !== tool.id)
                                : [...current, tool.id]
                            )
                          }
                          className={`rounded-full border px-2.5 py-1.5 text-[10px] ${
                            selected
                              ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                              : "border-[var(--color-border)] text-[var(--color-muted)]"
                          }`}
                        >
                          {tool.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex justify-end gap-2">
                    {isGeneratingExample ? (
                      <button
                        type="button"
                        onClick={() => exampleAbortRef.current?.abort()}
                        className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold"
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void generateExample()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[11px] font-semibold text-[var(--color-panel)]"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Generate & Append
                      </button>
                    )}
                  </div>
                  {streamedExample && (
                    <RichContent
                      className="prose lesson-prose prose-sm max-w-none border-t border-[var(--color-border)] pt-2"
                      onOpenMedia={setActiveMedia}
                    >
                      {streamedExample}
                    </RichContent>
                  )}
                </div>
              )}
              {examples.map((example) => (
                <article
                  key={example.id}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-[var(--color-ink)]">
                        {example.user_prompt || "Generated worked example"}
                      </p>
                      <p className="mt-1 text-[9px] text-[var(--color-muted)]">
                        {parseExampleTools(example.tools_json)
                          .map((id) => EXAMPLE_TOOLS.find((tool) => tool.id === id)?.label)
                          .filter(Boolean)
                          .join(" · ") || "Automatic example"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        aria-label="Copy worked example"
                        onClick={() => void copyExample(example.content_markdown)}
                        className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Regenerate worked example"
                        disabled={isGeneratingExample}
                        onClick={() => void generateExample(example)}
                        className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-hover)] disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete worked example"
                        onClick={() => setExampleToDelete(example)}
                        className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <RichContent
                    className="prose lesson-prose prose-sm max-w-none"
                    onOpenMedia={setActiveMedia}
                  >
                    {example.content_markdown}
                  </RichContent>
                </article>
              ))}
            </section>

            {citations.length > 0 && (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
                  <FileText className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                  <span>References &amp; Sources</span>
                </div>
                <ul className="mt-2 space-y-1.5 text-xs text-[var(--color-muted)]">
                  {citations.map((citation, idx) => {
                    const linkedCitation = citation.match(
                      /^(.*) — (https:\/\/\S+)$/
                    );
                    return (
                      <li key={idx} className="break-words">
                        •{" "}
                        {linkedCitation ? (
                          <>
                            {linkedCitation[1]} —{" "}
                            <a
                              href={linkedCitation[2]}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--color-accent)] underline"
                            >
                              View source
                            </a>
                          </>
                        ) : (
                          citation
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[10px] leading-4 text-[var(--color-muted)]">
                  AI-generated lesson; listed references are the available
                  supporting sources, not a complete list of training data.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-4">
        <button
          disabled={isHydrating || !isQuizAvailabilityLoaded}
          onClick={() => onStartDiagnostic(node.id)}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-accent-button)] px-3 py-2.5 text-xs font-semibold text-[var(--color-panel)] shadow-sm transition hover:brightness-95 disabled:opacity-50"
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
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel)] px-3 py-2.5 text-xs font-semibold text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] disabled:cursor-default disabled:text-[var(--color-success)]"
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
      {activeMedia && (
        <LessonMediaViewer
          media={activeMedia}
          onClose={() => setActiveMedia(null)}
        />
      )}
      {isOpen && exampleToDelete && (
        <ConfirmDeleteModal
          title="Delete worked example?"
          itemName={exampleToDelete.user_prompt || "Generated worked example"}
          description="Only this saved worked example will be removed. The concept, lesson, and other worked examples will remain."
          impactItems={[
            {
              label: "Other linked data",
              value: "None affected",
            },
          ]}
          onCancel={() => setExampleToDelete(null)}
          onConfirm={removeExample}
          onError={(error) =>
            onToast(error instanceof Error ? error.message : String(error))
          }
        />
      )}
    </aside>
  );
}