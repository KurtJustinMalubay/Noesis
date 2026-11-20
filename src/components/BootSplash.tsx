import { useEffect, useRef, useState, type TransitionEvent } from "react";

const MINIMUM_DISPLAY_MS = 550;
const EXIT_FALLBACK_MS = 320;

interface BootSplashProps {
  ready: boolean;
  status?: string;
}

export function BootSplash({ ready, status }: BootSplashProps) {
  const [isMounted, setIsMounted] = useState(true);
  const [isExiting, setIsExiting] = useState(false);
  const mountedAtRef = useRef(performance.now());
  const exitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    const remaining = Math.max(
      0,
      MINIMUM_DISPLAY_MS - (performance.now() - mountedAtRef.current)
    );
    const timer = window.setTimeout(() => setIsExiting(true), remaining);
    return () => window.clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (!isExiting) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    exitTimerRef.current = window.setTimeout(
      () => setIsMounted(false),
      reducedMotion ? 120 : EXIT_FALLBACK_MS
    );
    return () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [isExiting]);

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !isExiting) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (event.propertyName !== (reducedMotion ? "opacity" : "transform")) {
      return;
    }
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setIsMounted(false);
  };

  if (!isMounted) return null;

  return (
    <div
      onTransitionEnd={handleTransitionEnd}
      className={`boot-splash fixed inset-0 z-50 flex items-center justify-center ${
        isExiting ? "boot-splash-exiting" : ""
      }`}
      aria-hidden={isExiting}
    >
      <div className="flex flex-col items-center">
        <svg
          width="54"
          height="54"
          viewBox="0 0 54 54"
          fill="none"
          aria-label="Noesis"
          role="img"
        >
          <path
            d="M8 7h10l18 23V7h10v40H36L18 24v23H8V7Z"
            fill="var(--text-primary)"
          />
          <path
            d="M18 7h11l17 21v10L18 7Z"
            fill="var(--accent-primary)"
          />
        </svg>
        <div
          className="boot-splash-progress-track mt-7 rounded-full"
          role="progressbar"
          aria-label="Starting Noesis"
        >
          <div className="boot-splash-progress-indicator rounded-full" />
        </div>
        <p
          className="mt-3 font-mono text-[11px] tracking-wide text-[var(--text-muted)]"
          role="status"
          aria-live="polite"
        >
          {status ?? (ready ? "Ready" : "Initializing local vault…")}
        </p>
      </div>
    </div>
  );
}
