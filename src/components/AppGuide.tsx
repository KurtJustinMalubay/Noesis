import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useDelayedUnmount } from "./AnimatedPresence";

const STEPS = [
  {
    target: "settings",
    category: "Start here",
    title: "Welcome to Noesis",
    description:
      "Noesis keeps your learning workspace local-first with SQLite and FTS5, while letting you choose how AI is provided.",
    points: [
      "In Settings → AI, choose Google Gemini or a local OpenAI-compatible server such as Foundry Local, Ollama, or LM Studio. Local servers support one-click model detection.",
      "In Appearance & Themes, filter Dark and Light palettes, choose a low-glare or Mihon-inspired theme, and set your reading font.",
      "Set Lesson Depth to Concise, Standard, or Comprehensive to match the amount of detail you want.",
    ],
  },
  {
    target: "new-dag",
    category: "Build your curriculum",
    title: "Bring in notes, then create a DAG",
    description:
      "Ground lessons and tutor answers in your own material, then generate a curriculum with prerequisites in the right order.",
    points: [
      "Import local PDF, Markdown, and TXT files through Document Vault. Notes are indexed locally with SQLite FTS5 and searchable after a 400 ms debounce.",
      "Use New DAG with a topic prompt or an uploaded syllabus to create a prerequisite-first concept graph.",
      "Archive a workspace from Recent or archive a concept from its DAG toolbar. Restore archived items later, or permanently delete them from their archive.",
      "Vault sources can ground lessons and tutor answers with citations.",
    ],
  },
  {
    target: "canvas",
    category: "Map your learning",
    title: "Choose how to arrange the canvas",
    description:
      "Switch between a structured prerequisite map and an open canvas from the DAG toolbar.",
    points: [
      "Auto-Layout organizes concepts into LAYER 1, LAYER 2, and later prerequisite layers. Cards show locked, in-progress, and mastered states.",
      "Free Place removes the layer boxes and lets you drag concepts anywhere. Hold Shift while dragging to snap to the 16 px grid.",
      "Double-click empty canvas space or use + Add Node to create a custom concept. Drag a node’s bottom output port to another node’s top input port to add a prerequisite; cycle protection blocks circular links.",
    ],
  },
  {
    target: "canvas",
    category: "Study concepts",
    title: "Open lessons and add worked examples",
    description:
      "Select an unlocked concept to create and read its structured AI lesson, then make the material your own with examples.",
    points: [
      "Lessons support crisp KaTeX math and Mermaid diagrams. Drag the reader’s left edge to resize it.",
      "Choose + Generate Example, enter a scenario prompt, and append the result directly to the lesson.",
      "Example tools include Mermaid Diagram / Automata Graph, Step-by-Step Math, Code Walkthrough, State / Trace Table, and Real-World Analogy.",
    ],
  },
  {
    target: "tutor",
    category: "Practice and review",
    title: "Build mastery with quizzes, Tutor, and review",
    description:
      "Practice until concepts are mastered, ask follow-up questions, and revisit flashcards when they are due.",
    points: [
      "Assess with MCQ, open-ended, or coding questions—up to 12 per quiz—at Easy, Medium, Hard, or Hybrid difficulty. Passing unlocks dependent concepts.",
      "Use the Tutor button to open or close the chat. In chat settings, choose Socratic Tutor for guided learning or AI Assistant for direct answers. Replies can use the active lesson and cite your Document Vault sources.",
      "Use the daily SM-2 Review Queue to reinforce long-term recall.",
    ],
  },
  {
    target: "guide",
    category: "Keep these handy",
    title: "Keyboard shortcuts",
    description:
      "Use these shortcuts to move around Noesis without interrupting your study flow.",
    shortcuts: [
      ["F11", "Toggle Fullscreen"],
      ["Ctrl + \\", "Collapse / Expand Sidebar"],
      ["Double-Click Canvas", "Add Custom Node (in Free Place)"],
      ["Shift + Drag", "Snap Node to 16 px Grid"],
      ["Delete / Backspace", "Disconnect Selected Edge"],
      ["Esc", "Close Active Modal or Drawer"],
    ],
  },
] as const;

interface AppGuideProps {
  isOpen: boolean;
  onClose: () => void;
  showOnStartup: boolean;
  onShowOnStartupChange: (show: boolean) => void;
}

export function AppGuide({
  isOpen,
  onClose,
  showOnStartup,
  onShowOnStartupChange,
}: AppGuideProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetTransform, setTargetTransform] = useState(
    "translate3d(0, 0, 0) scale(1)"
  );
  const previousRect = useRef<DOMRect | null>(null);
  const animationFrames = useRef<number[]>([]);
  const onCloseRef = useRef(onClose);
  const { mounted, visible } = useDelayedUnmount(isOpen, 170);
  const step = STEPS[stepIndex];

  onCloseRef.current = onClose;

  useEffect(() => {
    if (isOpen) setStepIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setTargetRect(null);
      previousRect.current = null;
      return;
    }

    const updateTarget = () => {
      const target = document.querySelector(`[data-guide="${step.target}"]`);
      const nextRect = target?.getBoundingClientRect() ?? null;
      const previous = previousRect.current;
      previousRect.current = nextRect;
      if (nextRect && previous && nextRect.width > 0 && nextRect.height > 0) {
        animationFrames.current.forEach((frame) =>
          cancelAnimationFrame(frame)
        );
        setTargetTransform(
          `translate3d(${previous.left - nextRect.left}px, ${
            previous.top - nextRect.top
          }px, 0) scale(${previous.width / nextRect.width}, ${
            previous.height / nextRect.height
          })`
        );
        const firstFrame = requestAnimationFrame(() => {
          const secondFrame = requestAnimationFrame(() =>
            setTargetTransform("translate3d(0, 0, 0) scale(1)")
          );
          animationFrames.current = [secondFrame];
        });
        animationFrames.current = [firstFrame];
      }
      setTargetRect(nextRect);
    };

    updateTarget();
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
      animationFrames.current.forEach((frame) => cancelAnimationFrame(frame));
    };
  }, [isOpen, step.target]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      } else if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        event.target instanceof Element &&
        event.target.closest(
          "input, textarea, select, [contenteditable='true']"
        )
      ) {
        return;
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setStepIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setStepIndex((current) => Math.min(STEPS.length - 1, current + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!mounted) return null;

  return (
    <div
      className="motion-presence fixed inset-0 z-[70] pointer-events-none"
      data-motion="coachmark"
      data-presence={visible ? "visible" : "hidden"}
      aria-hidden={!isOpen}
      inert={!isOpen}
    >
      {targetRect && (
        <div
          className="motion-spotlight fixed rounded-xl border-2 border-[var(--accent-primary)]"
          style={{
            left: targetRect.left - 5,
            top: targetRect.top - 5,
            width: targetRect.width + 10,
            height: targetRect.height + 10,
            transform: targetTransform,
            boxShadow: "0 0 0 9999px rgba(13, 22, 30, 0.48)",
          }}
          aria-hidden="true"
        />
      )}
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Noesis App Guide"
        data-motion="popover"
        className="motion-popover pointer-events-auto fixed bottom-5 right-5 max-h-[min(82vh,760px)] w-[min(520px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 font-[var(--font-ui)] text-[var(--text-primary)] shadow-[0_16px_48px_rgba(0,0,0,0.28)] sm:bottom-6 sm:right-6 sm:p-6"
      >
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              Noesis · {step.category}
            </p>
            <p className="mt-1 text-[10px] font-medium text-[var(--text-secondary)]">
              Step {stepIndex + 1} of {STEPS.length}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
            aria-label="Close guide"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav
          aria-label="Guide steps"
          className="mt-4 flex gap-1.5"
          role="group"
        >
          {STEPS.map((item, index) => (
            <button
              key={item.title}
              type="button"
              onClick={() => setStepIndex(index)}
              aria-label={`Go to step ${index + 1}: ${item.title}`}
              aria-current={index === stepIndex ? "step" : undefined}
              className={`h-1.5 min-w-0 flex-1 rounded-full transition-colors ${
                index === stepIndex
                  ? "bg-[var(--accent-primary)]"
                  : "bg-[var(--border-subtle)] hover:bg-[var(--accent-soft)]"
              }`}
            />
          ))}
        </nav>

        <h2 className="mt-4 text-base font-semibold tracking-tight">
          {step.title}
        </h2>
        <p className="mt-1.5 text-xs leading-5 text-[var(--text-secondary)]">
          {step.description}
        </p>

        {"points" in step && (
          <ul className="mt-4 space-y-2.5">
            {step.points.map((point) => (
              <li
                key={point}
                className="flex gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs leading-5 text-[var(--text-primary)]"
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]"
                  aria-hidden="true"
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}

        {"shortcuts" in step && (
          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {step.shortcuts.map(([shortcut, action]) => (
              <div
                key={shortcut}
                className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
              >
                <dt>
                  <kbd className="inline-flex max-w-full rounded-md border border-[var(--border-subtle)] bg-[var(--accent-soft)] px-2 py-1 font-mono text-[10px] font-semibold text-[var(--accent-primary)]">
                    {shortcut}
                  </kbd>
                </dt>
                <dd className="mt-1.5 text-[11px] leading-4 text-[var(--text-secondary)]">
                  {action}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 text-xs">
          <span>Show guide on startup</span>
          <input
            type="checkbox"
            checked={showOnStartup}
            onChange={(event) => onShowOnStartupChange(event.target.checked)}
            className="h-4 w-4 accent-[var(--accent-primary)]"
          />
        </label>

        <footer className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-medium text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
          >
            {stepIndex === STEPS.length - 1 ? "Close" : "Skip / Close"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              disabled={stepIndex === 0}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 text-[var(--text-primary)] transition hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous guide step"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                stepIndex === STEPS.length - 1
                  ? onClose()
                  : setStepIndex((current) => current + 1)
              }
              className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-2 text-[11px] font-semibold text-[var(--bg-surface)] transition hover:brightness-95"
            >
              {stepIndex === STEPS.length - 1 ? "Done" : "Next"}
              {stepIndex < STEPS.length - 1 && (
                <ArrowRight className="h-3 w-3" />
              )}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
