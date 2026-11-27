import { Bell } from "lucide-react";
import { AnimatedPresence } from "./AnimatedPresence";

interface NotificationConsentModalProps {
  isOpen: boolean;
  error?: string | null;
  onEnable: () => void;
  onDismiss: () => void;
}

export function NotificationConsentModal({
  isOpen,
  error,
  onEnable,
  onDismiss,
}: NotificationConsentModalProps) {
  return (
    <AnimatedPresence
      present={isOpen}
      motion="modal"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/35 p-4"
      onBackdropClick={onDismiss}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-consent-title"
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-[var(--color-ink)] shadow-[0_24px_70px_rgba(27,39,47,0.2)]"
      >
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[var(--color-accent)]" />
          <h2
            id="notification-consent-title"
            className="font-serif text-lg font-semibold"
          >
            Enable native notifications?
          </h2>
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">
          Noesis can show Windows notifications for upcoming calendar events,
          important errors, and updates. Calendar event titles and workspace
          names may appear in notification banners.
        </p>
        <p className="mt-2 text-xs leading-5 text-[var(--color-muted)]">
          Windows desktop apps do not show a separate runtime permission
          dialog. After you opt in, Windows controls whether notifications can
          appear. If they are blocked, enable Noesis under Settings, System,
          Notifications.
        </p>
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 py-2 text-xs leading-5 text-[var(--color-ink)]"
          >
            {error}
          </p>
        )}
        <footer className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={onEnable}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-xs font-semibold text-[var(--color-panel)] transition hover:brightness-95"
          >
            Enable notifications
          </button>
        </footer>
      </section>
    </AnimatedPresence>
  );
}
