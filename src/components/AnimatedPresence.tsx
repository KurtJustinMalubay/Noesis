import { useEffect, useRef, useState, type ReactNode } from "react";

const DEFAULT_EXIT_DURATION = 320;

export function useDelayedUnmount(
  present: boolean,
  exitDuration = DEFAULT_EXIT_DURATION
): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(present);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    let enterFallback = 0;
    let timeout = 0;

    if (present) {
      setMounted(true);
      if (typeof window.requestAnimationFrame === "function") {
        frame = window.requestAnimationFrame(() => setVisible(true));
      } else {
        setVisible(true);
      }
      enterFallback = window.setTimeout(() => setVisible(true), 100);
    } else {
      setVisible(false);
      if (mounted) {
        const reducedMotion =
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
          false;
        if (reducedMotion) {
          setMounted(false);
        } else {
          timeout = window.setTimeout(
            () => setMounted(false),
            exitDuration
          );
        }
      }
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (enterFallback) window.clearTimeout(enterFallback);
      if (timeout) window.clearTimeout(timeout);
    };
  }, [present, exitDuration, mounted]);

  return { mounted, visible };
}

interface AnimatedPresenceProps {
  present: boolean;
  motion: "modal" | "side-panel" | "toast" | "popover";
  className?: string;
  exitDuration?: number;
  children: ReactNode;
}

export function AnimatedPresence({
  present,
  motion,
  className,
  exitDuration,
  children,
}: AnimatedPresenceProps) {
  const { mounted, visible } = useDelayedUnmount(present, exitDuration);
  const retainedChildren = useRef(children);

  useEffect(() => {
    if (present) retainedChildren.current = children;
  }, [children, present]);

  if (!mounted) return null;

  return (
    <div
      className={`motion-presence ${className ?? ""}`}
      data-motion={motion}
      data-presence={visible ? "visible" : "hidden"}
      aria-hidden={!present}
      inert={!present}
    >
      {present ? children : retainedChildren.current}
    </div>
  );
}
