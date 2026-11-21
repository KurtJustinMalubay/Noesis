import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, LoaderCircle, RotateCcw, Trash2, X } from "lucide-react";
import type { GraphNode } from "../types/domain";
import { listArchivedConceptNodes } from "../db/repositories/graphRepo";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

interface ArchivedConceptsDialogProps {
  workspaceId: string;
  onRestore: (workspaceId: string, nodeId: string) => Promise<void>;
  onPermanentlyDelete: (workspaceId: string, nodeId: string) => Promise<void>;
  onClose: () => void;
  onToast: (message: string | null) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ArchivedConceptsDialog({
  workspaceId,
  onRestore,
  onPermanentlyDelete,
  onClose,
  onToast,
}: ArchivedConceptsDialogProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GraphNode | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const deleteTargetRef = useRef(deleteTarget);
  onCloseRef.current = onClose;
  deleteTargetRef.current = deleteTarget;

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError(null);
    listArchivedConceptNodes(workspaceId)
      .then((archivedNodes) => {
        if (active) setNodes(archivedNodes);
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, workspaceId]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleteTargetRef.current) {
        onCloseRef.current();
        return;
      }
      if (deleteTargetRef.current) return;
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

  const restoreNode = async (node: GraphNode) => {
    setBusyNodeId(node.id);
    try {
      await onRestore(workspaceId, node.id);
      onToast(`Restored "${node.title}".`);
    } catch (error) {
      onToast(errorMessage(error));
    } finally {
      setBusyNodeId(null);
      setRefreshKey((key) => key + 1);
    }
  };

  const confirmPermanentDelete = async () => {
    if (!deleteTarget) return;
    try {
      await onPermanentlyDelete(workspaceId, deleteTarget.id);
      onToast(`Permanently deleted "${deleteTarget.title}".`);
    } finally {
      setRefreshKey((key) => key + 1);
    }
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
        onClick={(event) => {
          if (event.target === event.currentTarget && !deleteTarget) onClose();
        }}
      >
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="archived-concepts-title"
          tabIndex={-1}
          className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-[var(--color-ink)] shadow-2xl outline-none sm:p-6"
        >
          <header className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                <Archive className="h-5 w-5" />
              </span>
              <div>
                <h2
                  id="archived-concepts-title"
                  className="text-sm font-semibold"
                >
                  Archived concepts
                </h2>
                <p className="mt-1 text-[11px] text-[var(--color-muted)]">
                  Archived concepts stay in this workspace until permanently
                  deleted.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
              aria-label="Close archived concepts"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="mt-5 max-h-[55vh] space-y-2 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--color-muted)]">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Loading archive…
              </div>
            ) : loadError ? (
              <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800">
                Could not load archived concepts: {loadError}
              </p>
            ) : nodes.length === 0 ? (
              <p className="py-10 text-center text-xs text-[var(--color-muted)]">
                No archived concepts in this workspace.
              </p>
            ) : (
              nodes.map((node) => (
                <article
                  key={node.id}
                  className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-app-bg)] p-3"
                >
                  <Archive className="h-4 w-4 shrink-0 text-[var(--color-muted)]" />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-xs font-semibold">
                      {node.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--color-muted)]">
                      {node.summary_hint}
                    </p>
                    <p className="mt-1 text-[9px] text-[var(--color-muted)]">
                      Archived{" "}
                      {node.archived_at
                        ? new Date(node.archived_at).toLocaleDateString()
                        : "recently"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyNodeId !== null || isLoading}
                    onClick={() => void restoreNode(node)}
                    className="rounded-lg p-2 text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
                    title="Restore concept"
                    aria-label={`Restore ${node.title}`}
                  >
                    {busyNodeId === node.id ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={busyNodeId !== null || isLoading}
                    onClick={() => setDeleteTarget(node)}
                    className="rounded-lg p-2 text-[var(--color-muted)] hover:bg-rose-100 hover:text-rose-700 disabled:opacity-50"
                    title="Delete permanently"
                    aria-label={`Delete ${node.title} permanently`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </article>
              ))
            )}
          </div>

          <footer className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--color-border)] px-3.5 py-2 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
            >
              Done
            </button>
          </footer>
        </section>
      </div>
      {deleteTarget && (
        <ConfirmDeleteModal
          mode="delete"
          title="Delete concept permanently?"
          itemName={deleteTarget.title}
          description="This permanently removes the concept, its lesson, quiz, flashcards, worked examples, prerequisite connections, and concept board. This cannot be undone."
          deleteLabel="Delete permanently"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmPermanentDelete}
          onError={(error) => onToast(errorMessage(error))}
        />
      )}
    </>,
    document.body
  );
}
