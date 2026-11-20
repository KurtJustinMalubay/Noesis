import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AnimatedPresence } from "./AnimatedPresence";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FileUp,
  GraduationCap,
  HardDrive,
  KeyRound,
  Layers,
  Monitor,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  getReviewsCompletedToday,
  LOCAL_CONTEXT_WINDOW_MAX,
  LOCAL_CONTEXT_WINDOW_MIN,
  LOCAL_OUTPUT_TOKENS_MAX,
  LOCAL_OUTPUT_TOKENS_MIN,
  loadAiSettings,
  saveAiSettings,
} from "../ai/keyStore";
import { testGeminiConnection } from "../ai/geminiClient";
import { ingestLocalFilePath } from "../vault/ingestService";
import { useNoesisStore, type ActiveModal } from "../store/useNoesisStore";
import type { DueFlashcard } from "../db/repositories/flashcardRepo";
import type { StoredDocument } from "../db/repositories/documentRepo";
import {
  clearGeneratedDiagnostics,
  compactDatabase,
  getDatabaseStats,
  rebuildVaultIndex,
  type DatabaseStats,
} from "../db/repositories/maintenanceRepo";
import type { ReviewGrade } from "../engine/sm2Scheduler";
import type { CurriculumProgress } from "../ai/curriculumService";
import type {
  QuizAnswer,
  QuizDraft,
  QuizGenerationConfig,
  QuizGradingResult,
  QuizLanguage,
  QuizQuestion,
} from "../types/domain";
import type {
  AiProvider,
  AppTheme,
  UserPreferences,
} from "../ai/keyStore";
import { GEMINI_MODEL_OPTIONS as MODEL_OPTIONS } from "../ai/keyStore";
import { QuizArena } from "./QuizArena";
import { RichContent } from "./ui/RichContent";

const THEME_OPTIONS: Array<{
  id: AppTheme;
  label: string;
  swatches: [string, string, string];
}> = [
  {
    id: "daylight",
    label: "Windows 11 Daylight",
    swatches: ["#f5f6f3", "#ffffff", "#326a9f"],
  },
  {
    id: "mica-dark",
    label: "Windows 11 Mica Dark",
    swatches: ["#202020", "#2c2c2c", "#75a9e0"],
  },
  {
    id: "warm-paper",
    label: "Warm Paper",
    swatches: ["#f4efe5", "#fffaf0", "#8a6341"],
  },
  {
    id: "nordic-frost",
    label: "Nordic Frost",
    swatches: ["#edf2f5", "#fbfdff", "#507d9d"],
  },
  {
    id: "sage-studio",
    label: "Sage Studio",
    swatches: ["#eef1e8", "#fbfcf7", "#687b5d"],
  },
];

interface ModalsProps {
  activeModal: ActiveModal;
  activeWorkspaceId: string | null;
  selectedNodeId: string | null;
  selectedNodeTitle: string;
  theme: AppTheme;
  isGeneratingCurriculum: boolean;
  onCancelCurriculum: () => void;
  curriculumProgress: CurriculumProgress | null;
  masteryPassThreshold: UserPreferences["masteryPassThreshold"];
  dueCards: DueFlashcard[];
  documents: StoredDocument[];
  diagnosticQuestions: QuizQuestion[];
  diagnosticConfig: QuizGenerationConfig | null;
  diagnosticDraft: QuizDraft;
  diagnosticScore: number | null;
  isLoadingDiagnostic: boolean;
  isSubmittingDiagnostic: boolean;
  isConfiguringDiagnostic: boolean;
  diagnosticError: string | null;
  onClose: () => void;
  onGenerateCurriculum: (topic: string) => Promise<void>;
  onGradeCard: (card: DueFlashcard, grade: ReviewGrade) => Promise<void>;
  onStartDiagnostic: (nodeId: string) => Promise<void>;
  onConfigureDiagnostic: (nodeId: string) => void;
  onCancelDiagnosticConfiguration: () => void;
  onGenerateDiagnostic: (
    nodeId: string,
    config: QuizGenerationConfig
  ) => Promise<void>;
  onSaveDiagnosticDraft: (nodeId: string, draft: QuizDraft) => Promise<void>;
  onResetDiagnosticAttempt: (nodeId: string) => Promise<void>;
  onSubmitDiagnostic: (
    nodeId: string,
    answers: Record<string, QuizAnswer>,
    languages: Record<string, QuizLanguage>
  ) => Promise<{ score: number; passed: boolean; results: QuizGradingResult[] }>;
  onQuizCacheCleared: () => void;
  onCompleteNode: (nodeId: string) => Promise<void>;
  onRefreshDocuments: () => Promise<void>;
  onRemoveDocument: (docId: string) => Promise<void>;
  onToast: (msg: string) => void;
}

export function Modals({
  activeModal,
  activeWorkspaceId,
  selectedNodeId,
  selectedNodeTitle,
  theme,
  isGeneratingCurriculum,
  onCancelCurriculum,
  curriculumProgress,
  masteryPassThreshold,
  dueCards,
  documents,
  diagnosticQuestions,
  diagnosticConfig,
  diagnosticDraft,
  diagnosticScore,
  isLoadingDiagnostic,
  isSubmittingDiagnostic,
  isConfiguringDiagnostic,
  diagnosticError,
  onClose,
  onGenerateCurriculum,
  onGradeCard,
  onStartDiagnostic,
  onConfigureDiagnostic,
  onCancelDiagnosticConfiguration,
  onGenerateDiagnostic,
  onSaveDiagnosticDraft,
  onResetDiagnosticAttempt,
  onSubmitDiagnostic,
  onQuizCacheCleared,
  onCompleteNode,
  onRefreshDocuments,
  onRemoveDocument,
  onToast,
}: ModalsProps) {
  return (
    <>
      <AnimatedPresence
        present={activeModal !== "none" && activeModal !== "diagnostic"}
        motion="modal"
        exitDuration={170}
        className="motion-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#253641]/25 p-4 backdrop-blur-[3px]"
      >
        {activeModal === "new_workspace" && (
          <NewWorkspaceModal
            isGenerating={isGeneratingCurriculum}
            progress={curriculumProgress}
            onCancel={onCancelCurriculum}
            onClose={onClose}
            onGenerate={onGenerateCurriculum}
            onToast={onToast}
          />
        )}
        {activeModal === "review" && (
          <ReviewQueueModal
            dueCards={dueCards}
            onGrade={onGradeCard}
            onToast={onToast}
            onClose={onClose}
          />
        )}
        {activeModal === "completion" && (
          <CompletionPromptModal
            nodeId={selectedNodeId}
            onStartDiagnostic={onStartDiagnostic}
            onCompleteNode={onCompleteNode}
            onToast={onToast}
            onClose={onClose}
          />
        )}
        {activeModal === "vault" && (
          <DocumentVaultModal
            workspaceId={activeWorkspaceId}
            documents={documents}
            onRefresh={onRefreshDocuments}
            onRemove={onRemoveDocument}
            onToast={onToast}
            onClose={onClose}
          />
        )}
        {activeModal === "settings" && (
          <SettingsModal
            onToast={onToast}
            onClose={onClose}
            onQuizCacheCleared={onQuizCacheCleared}
          />
        )}
      </AnimatedPresence>
      {activeModal === "diagnostic" && (
        <QuizArena
          nodeId={selectedNodeId}
          lessonTitle={selectedNodeTitle}
          theme={theme}
          questions={diagnosticQuestions}
          savedConfig={diagnosticConfig}
          savedDraft={diagnosticDraft}
          savedScore={diagnosticScore}
          isLoading={isLoadingDiagnostic}
          isSubmitting={isSubmittingDiagnostic}
          isConfiguring={isConfiguringDiagnostic}
          error={diagnosticError}
          passThreshold={masteryPassThreshold}
          onClose={onClose}
          onConfigure={onConfigureDiagnostic}
          onCancelConfiguration={onCancelDiagnosticConfiguration}
          onGenerate={onGenerateDiagnostic}
          onSaveDraft={onSaveDiagnosticDraft}
          onResetAttempt={onResetDiagnosticAttempt}
          onSubmit={onSubmitDiagnostic}
          onToast={onToast}
        />
      )}
    </>
  );
}

function NewWorkspaceModal({
  isGenerating,
  progress,
  onCancel,
  onClose,
  onGenerate,
  onToast,
}: {
  isGenerating: boolean;
  progress: CurriculumProgress | null;
  onCancel: () => void;
  onClose: () => void;
  onGenerate: (topic: string) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const handleClose = () => {
    if (isGenerating && progress?.phase === "Saving curriculum…") return;
    if (isGenerating) onCancel();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isGenerating) return;
    try {
      await onGenerate(topic.trim());
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="w-full max-w-lg rounded-2xl border border-[#e1dfd9] bg-white p-6 shadow-[0_24px_70px_rgba(27,39,47,0.2)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-bold text-[#2c414f]">
          <Sparkles className="h-5 w-5 text-[#527a91]" />
          <span>Synthesize Knowledge DAG</span>
        </div>
        <button
          type="button"
          disabled={isGenerating && progress?.phase === "Saving curriculum…"}
          onClick={handleClose}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-[#f3f2ee] hover:text-slate-700 disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        Enter a learning goal; Noesis builds its prerequisite graph from your vault.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        {isGenerating && (
          <div className="rounded-xl border border-[#dbe5e8] bg-[#f7faf9] p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-[#31556a]">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#3978a8] border-t-transparent" />
              {progress?.phase ?? "Drafting prerequisite structure…"}
            </div>
            {progress?.nodeTitles.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {progress.nodeTitles.map((title) => (
                  <span
                    key={title}
                    className="rounded-full border border-[#dce5e4] bg-white px-2 py-1 text-[10px] text-slate-600"
                  >
                    {title}
                  </span>
                ))}
              </div>
            ) : null}
            {progress?.phase !== "Saving curriculum…" && (
              <button
                type="button"
                onClick={onCancel}
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-[#d8dfe2] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-[#f1f3f2]"
              >
                <X className="h-3 w-3" />
                Stop generation
              </button>
            )}
          </div>
        )}
        <textarea
          rows={3}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g., Automata Theory & Formal Languages, or C# Memory Management & Span<T>"
          className="w-full select-text rounded-xl border border-[#dedfdc] bg-[#fbfaf8] p-3 text-sm text-slate-800 placeholder-slate-400 focus:border-[#6f9ab6] focus:outline-none focus:ring-2 focus:ring-[#d9e7ef]"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={isGenerating && progress?.phase === "Saving curriculum…"}
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-slate-600 transition hover:bg-[#f3f2ee] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isGenerating || !topic.trim()}
            className="flex items-center gap-2 rounded-lg bg-[#245f9e] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#194d83] disabled:opacity-50"
          >
            {isGenerating ? "Building Graph..." : "Generate DAG"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ReviewQueueModal({
  dueCards,
  onGrade,
  onToast,
  onClose,
}: {
  dueCards: DueFlashcard[];
  onGrade: (card: DueFlashcard, grade: ReviewGrade) => Promise<void>;
  onToast: (msg: string) => void;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const current = dueCards[0];

  const handleRate = async (grade: ReviewGrade) => {
    if (!current) return;
    try {
      await onGrade(current, grade);
      setRevealed(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div     className="w-full max-w-lg rounded-2xl border border-[#e1dfd9] bg-white p-6 shadow-[0_16px_48px_rgba(27,39,47,0.14)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-bold text-[#2c414f]">
          <RotateCcw className="h-5 w-5 text-[#b47a2c]" />
          <span>SM-2 Daily Review Queue ({dueCards.length} due)</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-[#f3f2ee] hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!current ? (
        <div className="py-12 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-[#267565]" />
          <p className="mt-3 text-sm font-semibold text-slate-800">
            No cards remaining in today's review queue.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            No cards are due, or today's review limit has been reached.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          <span className="rounded-full bg-[#eef4f7] px-2.5 py-0.5 text-[10px] font-medium text-[#426b85]">
            {current.node_title}
          </span>
          <div className="mt-3 min-h-[160px] rounded-xl border border-[#e4e5e1] bg-[#fbfaf8] p-5 select-text">
            <RichContent className="prose prose-sm max-w-none font-semibold leading-6 text-slate-800">
              {current.front}
            </RichContent>
            {revealed && (
              <RichContent className="prose prose-sm mt-4 max-w-none border-t border-[#e4e5e1] pt-4 text-[#26705f]">
                {current.back}
              </RichContent>
            )}
          </div>

          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="mt-4 w-full rounded-xl bg-[#245f9e] py-2.5 text-xs font-semibold text-white transition hover:bg-[#194d83]"
            >
              Show Answer
            </button>
          ) : (
            <div className="mt-4 grid grid-cols-4 gap-2">
              <button
                onClick={() => handleRate(0)}
                className="rounded-lg border border-rose-200 bg-rose-50 py-2 text-xs font-semibold text-rose-800 transition hover:bg-rose-100"
              >
                Again (1d)
              </button>
              <button
                onClick={() => handleRate(1)}
                className="rounded-lg border border-amber-200 bg-amber-50 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
              >
                Hard
              </button>
              <button
                onClick={() => handleRate(2)}
                className="rounded-lg border border-sky-200 bg-sky-50 py-2 text-xs font-semibold text-sky-800 transition hover:bg-sky-100"
              >
                Good
              </button>
              <button
                onClick={() => handleRate(3)}
                className="rounded-lg border border-emerald-200 bg-emerald-50 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
              >
                Easy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CompletionPromptModal({
  nodeId,
  onStartDiagnostic,
  onCompleteNode,
  onToast,
  onClose,
}: {
  nodeId: string | null;
  onStartDiagnostic: (nodeId: string) => Promise<void>;
  onCompleteNode: (nodeId: string) => Promise<void>;
  onToast: (msg: string) => void;
  onClose: () => void;
}) {
  const [isCompleting, setIsCompleting] = useState(false);

  const handleCompleteNow = async () => {
    if (!nodeId) return;
    setIsCompleting(true);
    try {
      await onCompleteNode(nodeId);
      onClose();
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-[var(--color-ink)] shadow-[0_24px_70px_rgba(27,39,47,0.2)]">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-[var(--color-panel-subtle)] p-2 text-[var(--color-accent)]">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold">Ready to complete this module?</h3>
          <p className="mt-1.5 text-xs leading-5 text-[var(--color-muted)]">
            Take the mastery quiz to check your understanding, or finish now to
            mark this module complete and unlock the next available lesson.
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Keep studying"
          className="rounded-lg p-1 text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-5 grid gap-2">
        <button
          disabled={!nodeId}
          onClick={() => {
            if (nodeId) void onStartDiagnostic(nodeId);
          }}
          className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-xs font-semibold text-[var(--color-panel)] transition hover:brightness-95 disabled:opacity-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          Take mastery quiz
        </button>
        <button
          disabled={!nodeId || isCompleting}
          onClick={() => void handleCompleteNow()}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-4 py-2.5 text-xs font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)] disabled:opacity-50"
        >
          {isCompleting ? "Completing..." : "Complete now"}
        </button>
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
        >
          Keep studying
        </button>
      </div>
    </div>
  );
}

function DocumentVaultModal({
  workspaceId,
  documents,
  onRefresh,
  onRemove,
  onToast,
  onClose,
}: {
  workspaceId: string | null;
  documents: StoredDocument[];
  onRefresh: () => Promise<void>;
  onRemove: (docId: string) => Promise<void>;
  onToast: (msg: string) => void;
  onClose: () => void;
}) {
  const [isIngesting, setIsIngesting] = useState(false);

  const handlePickFiles = async () => {
    setIsIngesting(true);
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Study Docs", extensions: ["pdf", "md", "txt"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) {
        const res = await ingestLocalFilePath(p, workspaceId);
        if (res.deduplicated) {
          onToast(`Skipped duplicate (SHA-256 matched): ${res.document.file_name}`);
        } else {
          onToast(`Indexed ${res.document.file_name} (${res.chunkCount} FTS5 chunks)`);
        }
      }
      await onRefresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsIngesting(false);
    }
  };

  const handleRemoveDocument = async (docId: string) => {
    try {
      const document = documents.find((item) => item.id === docId);
      await onRemove(docId);
      await onRefresh();
      onToast(`Removed ${document?.file_name ?? "document"} from the local vault.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="w-full max-w-lg rounded-2xl border border-[#e1dfd9] bg-white p-6 shadow-[0_24px_70px_rgba(27,39,47,0.2)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-bold text-[#2c414f]">
          <Layers className="h-5 w-5 text-[#527a91]" />
          <span>Local FTS5 Document Vault</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-[#f3f2ee] hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-slate-600">
        Index PDFs, Markdown, or text notes locally with SHA-256 deduplication and
        SQLite BM25 full-text search.
      </p>

      <button
        disabled={isIngesting}
        onClick={handlePickFiles}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#9cb9cb] bg-[#f0f6f9] py-3 text-xs font-semibold text-[#326a8a] transition hover:bg-[#e7f0f4] disabled:opacity-50"
      >
        <FileUp className="h-4 w-4" />
        {isIngesting ? "Chunking & Indexing..." : "Import PDF / Markdown / TXT"}
      </button>

      <div className="mt-4 max-h-60 space-y-2 overflow-y-auto">
        {documents.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">
            No documents indexed yet.
          </p>
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between rounded-xl border border-[#e5e5e0] bg-[#fbfaf8] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800">
                  {doc.file_name}
                </p>
                <p className="font-mono text-[9px] text-slate-500">
                  {doc.page_count} page{doc.page_count > 1 ? "s" : ""} • SHA-256{" "}
                  {doc.file_hash.slice(0, 10)}...
                </p>
              </div>
              <button
                onClick={() => void handleRemoveDocument(doc.id)}
                className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SettingsModal({
  onToast,
  onClose,
  onQuizCacheCleared,
}: {
  onToast: (msg: string) => void;
  onClose: () => void;
  onQuizCacheCleared: () => void;
}) {
  type Section = "ai" | "canvas" | "study" | "vault";
  const sections: Array<{
    id: Section;
    title: string;
    icon: typeof Sparkles;
  }> = [
    { id: "canvas", title: "Appearance & Themes", icon: Monitor },
    { id: "ai", title: "AI & Speed", icon: Sparkles },
    { id: "study", title: "Study & SM-2", icon: GraduationCap },
    { id: "vault", title: "Vault & Data", icon: HardDrive },
  ];
  const store = useNoesisStore();
  const initial = loadAiSettings();
  const [provider, setProvider] = useState<AiProvider>(initial.provider);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [localBaseUrl, setLocalBaseUrl] = useState(initial.localBaseUrl);
  const [localModel, setLocalModel] = useState(initial.localModel);
  const [localContextWindowTokens, setLocalContextWindowTokens] = useState(
    String(initial.localContextWindowTokens)
  );
  const [localMaxOutputTokens, setLocalMaxOutputTokens] = useState(
    String(initial.localMaxOutputTokens)
  );
  const [localTemperature, setLocalTemperature] = useState(
    String(initial.localTemperature)
  );
  const [localTopP, setLocalTopP] = useState(String(initial.localTopP));
  const [creativityPreset, setCreativityPreset] =
    useState(initial.creativityPreset);
  const [fastModelSelection, setFastModelSelection] = useState(
    MODEL_OPTIONS.some((model) => model.id === initial.fastModel)
      ? initial.fastModel
      : "custom"
  );
  const [customFastModel, setCustomFastModel] = useState(
    MODEL_OPTIONS.some((model) => model.id === initial.fastModel)
      ? ""
      : initial.fastModel
  );
  const [synthesisModelSelection, setSynthesisModelSelection] = useState(
    MODEL_OPTIONS.some((model) => model.id === initial.synthesisModel)
      ? initial.synthesisModel
      : "custom"
  );
  const [customSynthesisModel, setCustomSynthesisModel] = useState(
    MODEL_OPTIONS.some((model) => model.id === initial.synthesisModel)
      ? ""
      : initial.synthesisModel
  );
  const [preferences, setPreferences] = useState(store.preferences);
  const [section, setSection] = useState<Section>("ai");
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isMaintaining, setIsMaintaining] = useState(false);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const fastModel =
    fastModelSelection === "custom" ? customFastModel : fastModelSelection;
  const synthesisModel =
    synthesisModelSelection === "custom"
      ? customSynthesisModel
      : synthesisModelSelection;
  const contextWindowValue = Number(localContextWindowTokens);
  const outputTokenValue = Number(localMaxOutputTokens);
  const temperatureValue = Number(localTemperature);
  const topPValue = Number(localTopP);
  const effectiveOutputTokenBudget = Math.min(
    outputTokenValue,
    contextWindowValue - 128 - 384
  );
  const estimatedPromptTokenBudget = Math.max(
    0,
    contextWindowValue - effectiveOutputTokenBudget - 128
  );

  const refreshStats = async () => {
    try {
      setStats(await getDatabaseStats());
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refreshStats();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (
        provider === "gemini" &&
        ((fastModelSelection === "custom" && !customFastModel.trim()) ||
          (synthesisModelSelection === "custom" &&
            !customSynthesisModel.trim()))
      ) {
        onToast("Enter a model ID for each custom model.");
        return;
      }
      if (
        provider === "openai-compatible" &&
        (!localBaseUrl.trim() || !localModel.trim())
      ) {
        onToast("Enter a local endpoint and model name.");
        return;
      }
      if (
        provider === "openai-compatible" &&
        (!Number.isInteger(contextWindowValue) ||
          contextWindowValue < LOCAL_CONTEXT_WINDOW_MIN ||
          contextWindowValue > LOCAL_CONTEXT_WINDOW_MAX ||
          !Number.isInteger(outputTokenValue) ||
          outputTokenValue < LOCAL_OUTPUT_TOKENS_MIN ||
          outputTokenValue > LOCAL_OUTPUT_TOKENS_MAX ||
          !Number.isFinite(temperatureValue) ||
          temperatureValue < 0 ||
          temperatureValue > 2 ||
          !Number.isFinite(topPValue) ||
          topPValue < 0 ||
          topPValue > 1)
      ) {
        onToast("Check the local model context, token, temperature, and top-p values.");
        return;
      }
      saveAiSettings({
        provider,
        apiKey,
        fastModel,
        synthesisModel,
        creativityPreset,
        localBaseUrl,
        localModel,
        localContextWindowTokens: contextWindowValue,
        localMaxOutputTokens: outputTokenValue,
        localTemperature: temperatureValue,
        localTopP: topPValue,
      });
      await store.setPreferences(preferences);
      onToast("Preferences saved locally.");
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConnectionTest = async () => {
    setIsTestingConnection(true);
    try {
      await testGeminiConnection({
        provider,
        apiKey: provider === "gemini" ? apiKey.trim() : undefined,
        modelId:
          provider === "gemini" ? fastModel : localModel.trim(),
        baseUrl: localBaseUrl.trim(),
      });
      onToast(
        provider === "gemini"
          ? "Gemini connection successful."
          : "Local AI connection successful."
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTestingConnection(false);
    }
  };

  const runMaintenance = async (
    action: () => Promise<void>,
    message: string
  ) => {
    setIsMaintaining(true);
    try {
      await action();
      setStats(await getDatabaseStats());
      onToast(message);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsMaintaining(false);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="flex h-[min(680px,88vh)] w-full max-w-[920px] overflow-hidden rounded-2xl border border-[#e1dfd9] bg-white shadow-[0_16px_48px_rgba(27,39,47,0.14)]"
    >
      <aside className="flex w-[218px] shrink-0 flex-col border-r border-[#e9e7e1] bg-[#f8f9f6] p-4">
        <div className="flex items-center gap-2 px-2 py-2 text-sm font-bold text-[#2c414f]">
          <KeyRound className="h-4 w-4 text-[#527a91]" />
          Settings
        </div>
        <nav className="mt-4 space-y-1">
          {sections.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition ${
                section === id
                  ? "bg-white text-[#245f78] shadow-sm ring-1 ring-[#e7e9e4]"
                  : "text-slate-600 hover:bg-white/70 hover:text-slate-800"
              }`}
            >
              <Icon className="h-4 w-4" />
              {title}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-2 pb-1 text-[10px] leading-4 text-slate-500">
          Local-first preferences
          <br />
          Saved on this device
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[#ebe8e2] px-6 py-4">
          <div>
            <h2 className="text-sm font-bold text-[#2c414f]">
              {sections.find((item) => item.id === section)?.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-[#f3f2ee] hover:text-slate-700"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 select-text">
          {section === "ai" && (
            <>
              <SettingsField label="Provider">
                <select
                  value={provider}
                  onChange={(event) =>
                    setProvider(event.target.value as AiProvider)
                  }
                  className={settingsDropdownClass}
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai-compatible">OpenAI-compatible local</option>
                </select>
              </SettingsField>
              {provider === "gemini" ? (
                <>
                  <section>
                    <h3 className="text-xs font-semibold text-slate-800">Gemini API key</h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Stored locally; sent only to Google.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <input
                        type={isKeyVisible ? "text" : "password"}
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder="Paste API key"
                        autoComplete="off"
                        className="min-w-0 flex-1 rounded-lg border border-[#dedfdc] bg-[#fbfaf8] px-3 py-2.5 text-xs text-slate-800 focus:border-[#6f9ab6] focus:outline-none focus:ring-2 focus:ring-[#d9e7ef]"
                      />
                      <button
                        type="button"
                        onClick={() => setIsKeyVisible((visible) => !visible)}
                        className="rounded-lg border border-[#dedfdc] px-3 text-slate-600 hover:bg-[#f8f7f4]"
                        aria-label={isKeyVisible ? "Hide API key" : "Show API key"}
                      >
                        {isKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        disabled={isTestingConnection || !apiKey.trim()}
                        onClick={() => void handleConnectionTest()}
                        className="rounded-lg border border-[#d7e3e5] bg-[#f4f8f7] px-3 text-xs font-semibold text-[#315d62] hover:bg-[#eaf2f0] disabled:opacity-50"
                      >
                        {isTestingConnection ? "Testing…" : "Test"}
                      </button>
                    </div>
                  </section>

                  <SettingsField label="Fast model">
                    <select
                      value={fastModelSelection}
                      onChange={(event) =>
                        setFastModelSelection(event.target.value)
                      }
                      className={settingsDropdownClass}
                    >
                      {MODEL_OPTIONS.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                      <option value="custom">Custom model ID…</option>
                    </select>
                    {fastModelSelection === "custom" && (
                      <input
                        value={customFastModel}
                        onChange={(event) => setCustomFastModel(event.target.value)}
                        placeholder="Custom fast model"
                        className={settingsSelectClass}
                      />
                    )}
                  </SettingsField>
                  <SettingsField label="Synthesis model">
                    <select
                      value={synthesisModelSelection}
                      onChange={(event) =>
                        setSynthesisModelSelection(event.target.value)
                      }
                      className={settingsDropdownClass}
                    >
                      {MODEL_OPTIONS.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                      <option value="custom">Custom model ID…</option>
                    </select>
                    {synthesisModelSelection === "custom" && (
                      <input
                        value={customSynthesisModel}
                        onChange={(event) =>
                          setCustomSynthesisModel(event.target.value)
                        }
                        placeholder="Custom synthesis model"
                        className={settingsSelectClass}
                      />
                    )}
                  </SettingsField>
                </>
              ) : (
                <>
                  <SettingsField label="Local endpoint">
                    <input
                      value={localBaseUrl}
                      onChange={(event) => setLocalBaseUrl(event.target.value)}
                      placeholder="http://localhost:11434/v1"
                      className={settingsSelectClass}
                    />
                  </SettingsField>
                  <SettingsField label="Local model">
                    <div className="flex gap-2">
                      <input
                        value={localModel}
                        onChange={(event) => setLocalModel(event.target.value)}
                        placeholder="Installed model name"
                        className={settingsSelectClass}
                      />
                      <button
                        type="button"
                        disabled={
                          isTestingConnection ||
                          !localModel.trim() ||
                          !localBaseUrl.trim()
                        }
                        onClick={() => void handleConnectionTest()}
                        className="mt-1 rounded-lg border border-[#d7e3e5] bg-[#f4f8f7] px-3 text-xs font-semibold text-[#315d62] hover:bg-[#eaf2f0] disabled:opacity-50"
                      >
                        {isTestingConnection ? "Testing…" : "Test"}
                      </button>
                    </div>
                  </SettingsField>
                  <section className="rounded-xl border border-[#e4e6e1] bg-[#fafaf7] p-4">
                    <h3 className="text-xs font-semibold text-slate-800">
                      Local inference limits
                    </h3>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">
                      These limits budget requests in Noesis; set the model
                      runtime to support the same or a larger context window.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <SettingsField label="Context window (tokens)">
                        <input
                          type="number"
                          min={LOCAL_CONTEXT_WINDOW_MIN}
                          max={LOCAL_CONTEXT_WINDOW_MAX}
                          step={256}
                          value={localContextWindowTokens}
                          onChange={(event) =>
                            setLocalContextWindowTokens(event.target.value)
                          }
                          className={settingsSelectClass}
                        />
                      </SettingsField>
                      <SettingsField label="Maximum response tokens">
                        <input
                          type="number"
                          min={LOCAL_OUTPUT_TOKENS_MIN}
                          max={LOCAL_OUTPUT_TOKENS_MAX}
                          step={128}
                          value={localMaxOutputTokens}
                          onChange={(event) =>
                            setLocalMaxOutputTokens(event.target.value)
                          }
                          className={settingsSelectClass}
                        />
                      </SettingsField>
                      <SettingsField label="Temperature (0–2)">
                        <input
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          value={localTemperature}
                          onChange={(event) =>
                            setLocalTemperature(event.target.value)
                          }
                          className={settingsSelectClass}
                        />
                      </SettingsField>
                      <SettingsField label="Top-p (0–1)">
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={localTopP}
                          onChange={(event) => setLocalTopP(event.target.value)}
                          className={settingsSelectClass}
                        />
                      </SettingsField>
                    </div>
                    <p className="mt-2 text-[10px] text-slate-500">
                      {Number.isFinite(estimatedPromptTokenBudget)
                        ? `Prompt budget up to ~${estimatedPromptTokenBudget.toLocaleString()} tokens after response allowance and safety buffer.`
                        : "Enter a valid context and response token limit to see the prompt budget."}
                    </p>
                  </section>
                </>
              )}
              <SettingsField label="Creativity preset">
                <select
                  value={creativityPreset}
                  onChange={(event) =>
                    setCreativityPreset(
                      event.target.value as typeof creativityPreset
                    )
                  }
                  className={settingsDropdownClass}
                >
                  <option value="focused">Focused · precise and deterministic</option>
                  <option value="balanced">Balanced · recommended</option>
                  <option value="exploratory">Exploratory · broader variation</option>
                </select>
              </SettingsField>
            </>
          )}

          {section === "canvas" && (
            <>
              <SettingsField label="Theme">
                <div className="grid grid-cols-2 gap-2">
                  {THEME_OPTIONS.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      aria-pressed={preferences.theme === theme.id}
                      onClick={() => {
                        const nextPreferences = {
                          ...preferences,
                          theme: theme.id,
                        };
                        setPreferences(nextPreferences);
                        void store
                          .setPreferences(nextPreferences)
                          .catch((error) =>
                            onToast(
                              error instanceof Error
                                ? error.message
                                : String(error)
                            )
                          );
                      }}
                      className={`rounded-xl border p-2 text-left transition ${
                        preferences.theme === theme.id
                          ? "border-[#6f9ab6] ring-2 ring-[#d9e7ef]"
                          : "border-[#e2e4df] hover:border-[#bfcbd0]"
                      }`}
                    >
                      <span className="mb-2 flex h-8 overflow-hidden rounded-lg border border-black/5">
                        {theme.swatches.map((color) => (
                          <span
                            key={color}
                            className="flex-1"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-700">
                        {theme.label}
                      </span>
                    </button>
                  ))}
                </div>
              </SettingsField>
              <SettingsField label="Canvas background">
                <label className="flex items-center justify-between rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] px-3 py-3 text-xs text-slate-700">
                  <span>Show subtle canvas dots</span>
                  <input
                    type="checkbox"
                    checked={preferences.showCanvasDots}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        showCanvasDots: event.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-[#326a9f]"
                  />
                </label>
              </SettingsField>
              <SettingsField label="Dependency edge routing">
                <SegmentedSetting
                  value={preferences.edgeRouting}
                  options={[
                    ["curved", "Curved"],
                    ["orthogonal", "Stepped"],
                  ]}
                  onChange={(value) =>
                    setPreferences({
                      ...preferences,
                      edgeRouting: value as UserPreferences["edgeRouting"],
                    })
                  }
                />
              </SettingsField>
              <SettingsField label="Node density">
                <SegmentedSetting
                  value={preferences.nodeDensity}
                  options={[
                    ["comfortable", "Comfortable"],
                    ["compact", "Compact"],
                  ]}
                  onChange={(value) =>
                    setPreferences({
                      ...preferences,
                      nodeDensity: value as UserPreferences["nodeDensity"],
                    })
                  }
                />
              </SettingsField>
              <SettingsField label="Window">
                <label className="flex items-center justify-between rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] px-3 py-3 text-xs text-slate-700">
                  <span>Launch in fullscreen</span>
                  <input
                    type="checkbox"
                    checked={preferences.launchInFullscreen}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        launchInFullscreen: event.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-[#326a9f]"
                  />
                </label>
              </SettingsField>
            </>
          )}

          {section === "study" && (
            <>
              <SettingsField label="Mastery quiz pass threshold">
                <select
                  value={preferences.masteryPassThreshold}
                  onChange={(event) =>
                    setPreferences({
                      ...preferences,
                      masteryPassThreshold: Number(
                        event.target.value
                      ) as UserPreferences["masteryPassThreshold"],
                    })
                  }
                  className={settingsDropdownClass}
                >
                  <option value={70}>70% · Accessible</option>
                  <option value={80}>80% · Recommended</option>
                  <option value={90}>90% · Rigorous</option>
                </select>
              </SettingsField>
              <SettingsField label="Daily SM-2 review limit">
                <select
                  value={preferences.dailyReviewLimit}
                  onChange={(event) =>
                    setPreferences({
                      ...preferences,
                      dailyReviewLimit: Number(
                        event.target.value
                      ) as UserPreferences["dailyReviewLimit"],
                    })
                  }
                  className={settingsDropdownClass}
                >
                  <option value={10}>10 cards per day</option>
                  <option value={20}>20 cards per day</option>
                  <option value={40}>40 cards per day</option>
                  <option value={0}>No daily limit</option>
                </select>
                <p className="mt-1.5 text-[10px] text-slate-500">
                  {preferences.dailyReviewLimit === 0
                    ? "The queue includes every card currently due."
                    : `Reviews completed today: ${Math.min(
                        preferences.dailyReviewLimit,
                        getReviewsCompletedToday()
                      )} / ${preferences.dailyReviewLimit}`}
                </p>
              </SettingsField>
              <SettingsField label="App tutorial">
                <label className="flex items-center justify-between rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] px-3 py-3 text-xs text-slate-700">
                  <span>Show App Tutorial</span>
                  <input
                    type="checkbox"
                    checked={preferences.showAppTutorial}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        showAppTutorial: event.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-[#326a9f]"
                  />
                </label>
              </SettingsField>
            </>
          )}

          {section === "vault" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Workspaces" value={stats?.workspaceCount} />
                <StatCard label="Concept nodes" value={stats?.nodeCount} />
                <StatCard label="Documents" value={stats?.documentCount} />
                <StatCard label="Indexed FTS5 chunks" value={stats?.chunkCount} />
                <StatCard
                  label="Database size"
                  value={
                    stats
                      ? `${(stats.databaseSizeBytes / (1024 * 1024)).toFixed(2)} MB`
                      : undefined
                  }
                />
              </div>
              <div className="rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] p-4">
                <h3 className="text-xs font-semibold text-slate-800">
                  Local database maintenance
                </h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Rebuild search, optimize storage, or clear quiz cache. Documents and graphs stay intact.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isMaintaining}
                    onClick={() =>
                      void runMaintenance(rebuildVaultIndex, "Vault search index rebuilt.")
                    }
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-[#dce4e5] bg-white px-2 py-2 text-[10px] font-semibold text-slate-700 hover:bg-[#f5f7f5] disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Rebuild FTS5 index
                  </button>
                  <button
                    type="button"
                    disabled={isMaintaining}
                    onClick={() =>
                      void runMaintenance(compactDatabase, "SQLite database optimized.")
                    }
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-[#dce4e5] bg-white px-2 py-2 text-[10px] font-semibold text-slate-700 hover:bg-[#f5f7f5] disabled:opacity-50"
                  >
                    <HardDrive className="h-3.5 w-3.5" />
                    Optimize database
                  </button>
                  <button
                    type="button"
                    disabled={isMaintaining}
                    onClick={() => {
                      if (window.confirm("Clear cached diagnostic quizzes? They will be regenerated when needed.")) {
                        void runMaintenance(
                          async () => {
                            await clearGeneratedDiagnostics();
                            onQuizCacheCleared();
                          },
                          "Generated quiz cache cleared."
                        );
                      }
                    }}
                    className="col-span-2 rounded-lg border border-[#eadfda] bg-white px-2 py-2 text-[10px] font-semibold text-[#805141] hover:bg-[#fcf7f5] disabled:opacity-50"
                  >
                    Clear generated quiz cache
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[#ebe8e2] px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-xs text-slate-600 transition hover:bg-[#f3f2ee]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[#245f9e] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#194d83]"
          >
            Save preferences
          </button>
        </footer>
      </div>
    </form>
  );
}

const settingsSelectClass =
  "mt-1 w-full select-text rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 py-2.5 text-xs text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)]";
const settingsDropdownClass = `${settingsSelectClass} settings-dropdown appearance-none pr-10`;

function SettingsField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium text-slate-700">{label}</legend>
      <div className="mt-1">{children}</div>
    </fieldset>
  );
}

function SegmentedSetting({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-[#e3e4df] bg-[#f7f8f5] p-1">
      {options.map(([option, label]) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
            value === option
              ? "bg-white text-[#285c78] shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number | string | undefined;
}) {
  return (
    <div className="rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] p-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-[#2c414f]">
        {value ?? "…"}
      </p>
    </div>
  );
}