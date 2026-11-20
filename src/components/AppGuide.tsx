import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useDelayedUnmount } from "./AnimatedPresence";

const STEPS = [
  {
    target: "vault",
    title: "Add notes to Vault",
    description: "Import local PDFs or text to ground lessons in your sources.",
  },
  {
    target: "new-dag",
    title: "Generate a DAG",
    description: "Describe a subject to build a prerequisite-first curriculum.",
  },
  {
    target: "canvas",
    title: "Learn & test out",
    description: "Open an unlocked concept, study the lesson, then take its quiz.",
  },
  {
    target: "review-queue",
    title: "Daily SM-2 review",
    description: "Review due cards to strengthen long-term recall.",
  },
];

interface AppGuideProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AppGuide({ isOpen, onClose }: AppGuideProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetTransform, setTargetTransform] = useState(
    "translate3d(0, 0, 0) scale(1)"
  );
  const previousRect = useRef<DOMRect | null>(null);
  const animationFrames = useRef<number[]>([]);
  const { mounted, visible } = useDelayedUnmount(isOpen, 170);
  const step = STEPS[stepIndex];

  useEffect(() => {
    if (isOpen) setStepIndex(0);
  }, [isOpen]);

  useEffect(() => {
    const updateTarget = () => {
      const target = document.querySelector(`[data-guide="${step.target}"]`);
      const nextRect = target?.getBoundingClientRect() ?? null;
      const previous = previousRect.current;
      previousRect.current = nextRect;
      if (nextRect && previous) {
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
    return () => {
      window.removeEventListener("resize", updateTarget);
      animationFrames.current.forEach((frame) => cancelAnimationFrame(frame));
    };
  }, [isOpen, step.target]);

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
          className="motion-spotlight fixed rounded-xl border-2 border-[var(--color-accent)]"
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
        aria-label="App tutorial"
        data-motion="popover"
        className="motion-popover pointer-events-auto fixed bottom-6 right-6 w-[min(360px,calc(100vw-32px))] rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-[var(--color-ink)] shadow-[0_16px_48px_rgba(0,0,0,0.22)]"
      >
        <header className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-muted)]">
            {stepIndex + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
            aria-label="Close tutorial"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <h2 className="mt-3 text-sm font-semibold">{step.title}</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">
          {step.description}
        </p>
        <footer className="mt-5 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            Skip
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex((current) => current - 1)}
                className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
                aria-label="Previous tutorial step"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                stepIndex === STEPS.length - 1
                  ? onClose()
                  : setStepIndex((current) => current + 1)
              }
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent-button)] px-3 py-2 text-[11px] font-semibold text-white hover:brightness-95"
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
