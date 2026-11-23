import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useDelayedUnmount } from "./AnimatedPresence";

const STEPS = [
  {
    target: "settings",
    title: "Welcome",
    description: "Set up Noesis to look and work the way you like.",
    points: [
      "Choose an AI service in Settings → AI. Follow the on-screen steps to connect it.",
      "Choose a theme and font in Appearance & Themes. Set lesson length in AI & Speed.",
    ],
  },
  {
    target: "new-dag",
    title: "Create a workspace",
    description:
      "A workspace is where you organize and study a subject.",
    points: [
      "Choose New Workspace → Generate with AI to build a learning map from a topic or your notes.",
      "Choose Start manually to make your own map. Add PDFs or notes in Document Vault.",
    ],
  },
  {
    target: "canvas",
    title: "Organize your topics",
    description:
      "Arrange topics and show how they connect.",
    points: [
      "Choose Auto Layout to arrange topics for you, or Free Place to move them anywhere.",
      "Drag a topic’s bottom dot to another topic’s top dot to connect them. Select a line and choose Disconnect to remove it.",
      "In Free Place, double-click an empty area to add a topic.",
    ],
  },
  {
    target: "canvas",
    title: "Open a lesson",
    description:
      "Each topic has a lesson to help you learn about it.",
    points: [
      "Click a topic without a lock to open its lesson.",
      "Choose Generate Example to see a worked example.",
    ],
  },
  {
    target: "tutor",
    title: "Practice and get help",
    description:
      "Check what you’ve learned and ask questions when you need help.",
    points: [
      "Take a quiz to check your understanding. Passing a quiz opens the next topics.",
      "Open Tutor to ask a question. Choose Socratic Tutor for hints or AI Assistant for direct answers.",
      "Use Flashcards to review cards when they’re due.",
    ],
  },
  {
    target: "guide",
    title: "Quick shortcuts",
    description: "Use these keys to move around faster.",
    shortcuts: [
      ["F11", "Turn full screen on or off"],
      ["Ctrl + \\", "Show or hide the sidebar"],
      ["Delete / Backspace", "Remove a selected connection"],
      ["Esc", "Close the open window or panel"],
    ],
  },
] as const;

interface AppGuideProps {
  isOpen: boolean;
  flashcardsEnabled: boolean;
  onClose: () => void;
  showOnStartup: boolean;
  onShowOnStartupChange: (show: boolean) => void;
}

export function AppGuide({
  isOpen,
  flashcardsEnabled,
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
  const visiblePoints =
    "points" in step
      ? step.points.filter(
          (point) =>
            flashcardsEnabled ||
            (!point.toLowerCase().includes("flashcard") &&
              !point.toLowerCase().includes("review queue"))
        )
      : [];

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
            <p className="text-xs font-medium text-[var(--text-secondary)]">
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
        <p className="mt-1.5 text-sm leading-6 text-[var(--text-secondary)]">
          {step.description}
        </p>

        {"points" in step && (
          <ul className="mt-4 space-y-2.5">
            {visiblePoints.map((point) => (
              <li
                key={point}
                className="flex gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm leading-6 text-[var(--text-primary)]"
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
                <dd className="mt-1.5 text-xs leading-5 text-[var(--text-secondary)]">
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
            Close guide
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
