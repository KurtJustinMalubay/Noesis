import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";

export interface DeleteImpactItem {
  label: string;
  value: ReactNode;
}

interface ConfirmDeleteModalProps {
  title: string;
  itemName: string;
  description: ReactNode;
  impactItems?: DeleteImpactItem[];
  deleteLabel?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  onError: (error: unknown) => void;
}

export function ConfirmDeleteModal({
  title,
  itemName,
  description,
  impactItems = [],
  deleteLabel = "Delete",
  onCancel,
  onConfirm,
  onError,
}: ConfirmDeleteModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const isDeletingRef = useRef(false);
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
        if (!isDeletingRef.current) onCancelRef.current();
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

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const handleConfirm = async () => {
    if (isDeletingRef.current) return;
    isDeletingRef.current = true;
    setIsDeleting(true);
    try {
      await onConfirm();
      onCancelRef.current();
    } catch (error) {
      isDeletingRef.current = false;
      setIsDeleting(false);
      onErrorRef.current(error);
    }
  };

  return createPortal(
    <div
      className="confirm-delete-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isDeletingRef.current) {
          onCancelRef.current();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        aria-describedby="confirm-delete-description"
        className="confirm-delete-panel w-full max-w-[420px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 text-[var(--text-primary)] shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2
              id="confirm-delete-title"
              className="text-sm font-semibold tracking-tight"
            >
              {title}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              Permanently delete{" "}
              <strong className="break-words font-semibold text-[var(--text-primary)]">
                {itemName}
              </strong>
              ?
            </p>
          </div>
        </div>

        <p
          id="confirm-delete-description"
          className="mt-4 text-xs leading-5 text-[var(--text-secondary)]"
        >
          {description}
        </p>

        {impactItems.length > 0 && (
          <dl className="mt-4 divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3">
            {impactItems.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-4 py-2 text-xs"
              >
                <dt className="text-[var(--text-secondary)]">{item.label}</dt>
                <dd className="text-right font-semibold text-[var(--text-primary)]">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={() => {
              if (!isDeletingRef.current) onCancelRef.current();
            }}
            disabled={isDeleting}
            className="rounded-lg border border-[var(--border-subtle)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={isDeleting}
            className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-lg bg-rose-700 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
          >
            {isDeleting ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {isDeleting ? "Deleting…" : deleteLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
