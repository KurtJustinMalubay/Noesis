import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, LoaderCircle, LogOut } from "lucide-react";

interface ExitConfirmationModalProps {
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  onError: (error: unknown) => void;
}

export function ExitConfirmationModal({
  onCancel,
  onConfirm,
  onError,
}: ExitConfirmationModalProps) {
  const [isExiting, setIsExiting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const isExitingRef = useRef(false);
  const onCancelRef = useRef(onCancel);
  const onErrorRef = useRef(onError);
  onCancelRef.current = onCancel;
  onErrorRef.current = onError;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!isExitingRef.current) onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const confirmExit = async () => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    setIsExiting(true);
    try {
      await onConfirm();
      onCancelRef.current();
    } catch (error) {
      isExitingRef.current = false;
      setIsExiting(false);
      onErrorRef.current(error);
    }
  };

  return createPortal(
    <div
      className="exit-confirmation-backdrop fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isExitingRef.current) {
          onCancelRef.current();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        data-exit-confirmation
        aria-modal="true"
        aria-labelledby="exit-confirmation-title"
        aria-describedby="exit-confirmation-description"
        className="exit-confirmation-panel w-full max-w-[420px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 text-[var(--text-primary)] shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2
              id="exit-confirmation-title"
              className="text-sm font-semibold tracking-tight"
            >
              Exit Noesis?
            </h2>
            <p
              id="exit-confirmation-description"
              className="mt-2 text-xs leading-5 text-[var(--text-secondary)]"
            >
              Noesis will close. Changes already saved locally will remain, but
              unsaved form or settings edits will be discarded, and any AI
              generation or file import in progress will stop.
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={() => {
              if (!isExitingRef.current) onCancelRef.current();
            }}
            disabled={isExiting}
            className="rounded-lg border border-[var(--border-subtle)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:opacity-50"
          >
            Stay in Noesis
          </button>
          <button
            type="button"
            onClick={() => void confirmExit()}
            disabled={isExiting}
            className="inline-flex min-w-[120px] items-center justify-center gap-1.5 rounded-lg bg-rose-700 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-wait disabled:opacity-70"
          >
            {isExiting ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            )}
            {isExiting ? "Exiting…" : "Exit Noesis"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
