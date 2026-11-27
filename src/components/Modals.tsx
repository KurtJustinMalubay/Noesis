import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AnimatedPresence } from "./AnimatedPresence";
import {
  CheckCircle2,
  Command,
  LogOut,
  Plus,
  Pencil,
  Eye,
  EyeOff,
  FileUp,
  GraduationCap,
  HardDrive,
  KeyRound,
  Layers,
  Monitor,
  Puzzle,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { isTtsSupported, speakWithAppVoice, stopSpeaking } from "../utils/speech";
import {
  getOpenAiPreset,
  getReviewsCompletedToday,
  LOCAL_CONTEXT_WINDOW_MAX,
  LOCAL_CONTEXT_WINDOW_MIN,
  LOCAL_OUTPUT_TOKENS_MAX,
  LOCAL_OUTPUT_TOKENS_MIN,
  loadAiSettings,
  OPENAI_COMPATIBLE_PRESETS,
  saveAiSettings,
  APP_THEME_OPTIONS,
  type OpenAiCompatiblePresetId,
} from "../ai/keyStore";
import { fetchOpenAiModels, testGeminiConnection } from "../ai/geminiClient";
import { ingestLocalFilePath } from "../vault/ingestService";
import { useNoesisStore, type ActiveModal } from "../store/useNoesisStore";
import { usePluginStore } from "../plugins/pluginStore";
import {
  BUILT_IN_PLUGINS,
  FLASHCARDS_PLUGIN_ID,
  KOKORO_TTS_PLUGIN_ID,
} from "../plugins/registry";
import { KokoroVoiceSettings } from "./KokoroVoiceSettings";
import type {
  DueFlashcard,
  WorkspaceFlashcard,
} from "../db/repositories/flashcardRepo";
import {
  countDocumentChunks,
  searchVaultFts,
  type RetrievedChunk,
  type StoredDocument,
} from "../db/repositories/documentRepo";
import {
  clearGeneratedDiagnostics,
  countGeneratedDiagnostics,
  compactDatabase,
  getDatabaseStats,
  rebuildVaultIndex,
  type DatabaseStats,
} from "../db/repositories/maintenanceRepo";
import type { ReviewGrade } from "../engine/sm2Scheduler";
import type {
  CurriculumProgress,
  CurriculumSourceDocument,
} from "../ai/curriculumService";
import type {
  GraphNode,
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
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import type { QuizBatchProgress } from "../ai/quizService";
import {
  getNativeFullscreen,
  setNativeFullscreen,
} from "../utils/windowControls";

interface ModalsProps {
  activeModal: ActiveModal;
  activeWorkspaceId: string | null;
  selectedNodeId: string | null;
  initialWorkspacePrompt?: string;
  selectedNodeTitle: string;
  theme: AppTheme;
  isGeneratingCurriculum: boolean;
  onCancelCurriculum: () => void;
  curriculumProgress: CurriculumProgress | null;
  masteryPassThreshold: UserPreferences["masteryPassThreshold"];
  dueCards: DueFlashcard[];
  flashcardNodes: GraphNode[];
  documents: StoredDocument[];
  diagnosticQuestions: QuizQuestion[];
  diagnosticConfig: QuizGenerationConfig | null;
  diagnosticDraft: QuizDraft;
  diagnosticScore: number | null;
  isLoadingDiagnostic: boolean;
  isGeneratingDiagnostic: boolean;
  diagnosticProgress: QuizBatchProgress | null;
  isSubmittingDiagnostic: boolean;
  isConfiguringDiagnostic: boolean;
  diagnosticError: string | null;
  onClose: () => void;
  onCreateWorkspace: (title: string, rootDomain?: string) => Promise<void>;
  onGenerateCurriculum: (
    topic: string,
    sourceDocument?: CurriculumSourceDocument
  ) => Promise<void>;
  onGradeCard: (card: DueFlashcard, grade: ReviewGrade) => Promise<void>;
  onLoadFlashcards: (workspaceId: string) => Promise<WorkspaceFlashcard[]>;
  onGenerateFlashcardsForTopic: (
    nodeId: string,
    topic: string
  ) => Promise<WorkspaceFlashcard[]>;
  onCreateFlashcard: (
    nodeId: string,
    front: string,
    back: string
  ) => Promise<WorkspaceFlashcard>;
  onEditFlashcard: (
    card: WorkspaceFlashcard,
    front: string,
    back: string
  ) => Promise<WorkspaceFlashcard>;
  onRemoveFlashcard: (card: WorkspaceFlashcard) => Promise<void>;
  onStartDiagnostic: (nodeId: string) => Promise<void>;
  onConfigureDiagnostic: (nodeId: string) => void;
  onCancelDiagnosticConfiguration: () => void;
  onCancelDiagnosticGeneration: () => void;
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
  onRequestExit: () => void;
  settingsGuideRequest: {
    section: "canvas" | "ai";
    requestId: number;
  } | null;
  settingsCloseRequest: number;
}

export function Modals({
  activeModal,
  activeWorkspaceId,
  selectedNodeId,
  initialWorkspacePrompt,
  selectedNodeTitle,
  theme,
  isGeneratingCurriculum,
  onCancelCurriculum,
  curriculumProgress,
  masteryPassThreshold,
  dueCards,
  flashcardNodes,
  documents,
  diagnosticQuestions,
  diagnosticConfig,
  diagnosticDraft,
  diagnosticScore,
  isLoadingDiagnostic,
  isGeneratingDiagnostic,
  diagnosticProgress,
  isSubmittingDiagnostic,
  isConfiguringDiagnostic,
  diagnosticError,
  onClose,
  onCreateWorkspace,
  onGenerateCurriculum,
  onGradeCard,
  onLoadFlashcards,
  onGenerateFlashcardsForTopic,
  onCreateFlashcard,
  onEditFlashcard,
  onRemoveFlashcard,
  onStartDiagnostic,
  onConfigureDiagnostic,
  onCancelDiagnosticConfiguration,
  onCancelDiagnosticGeneration,
  onGenerateDiagnostic,
  onSaveDiagnosticDraft,
  onResetDiagnosticAttempt,
  onSubmitDiagnostic,
  onQuizCacheCleared,
  onCompleteNode,
  onRefreshDocuments,
  onRemoveDocument,
  onToast,
  onRequestExit,
  settingsGuideRequest,
  settingsCloseRequest,
}: ModalsProps) {
  const [backdropSettingsCloseRequest, setBackdropSettingsCloseRequest] =
    useState(0);

  const handleBackdropClick = () => {
    if (activeModal === "new_workspace" && isGeneratingCurriculum) return;
    if (activeModal === "settings") {
      setBackdropSettingsCloseRequest((count) => count + 1);
      return;
    }
    onClose();
  };

  return (
    <>
      <AnimatedPresence
        present={activeModal !== "none" && activeModal !== "diagnostic"}
        motion="modal"
        exitDuration={170}
        onBackdropClick={handleBackdropClick}
        className="motion-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#253641]/25 p-4 backdrop-blur-[3px]"
      >
        {activeModal === "new_workspace" && (
          <NewWorkspaceModal
            isGenerating={isGeneratingCurriculum}
            progress={curriculumProgress}
            onCancel={onCancelCurriculum}
            onClose={onClose}
            onCreateWorkspace={onCreateWorkspace}
            onGenerate={onGenerateCurriculum}
            initialTopic={initialWorkspacePrompt ?? ""}
            onRefreshDocuments={onRefreshDocuments}
            onToast={onToast}
          />
        )}
        {activeModal === "review" && (
          <ReviewQueueModal
            workspaceId={activeWorkspaceId}
            selectedNodeId={selectedNodeId}
            nodes={flashcardNodes}
            dueCards={dueCards}
            onLoadFlashcards={onLoadFlashcards}
            onGenerateFlashcardsForTopic={onGenerateFlashcardsForTopic}
            onCreateFlashcard={onCreateFlashcard}
            onEditFlashcard={onEditFlashcard}
            onRemoveFlashcard={onRemoveFlashcard}
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
            onRequestExit={onRequestExit}
            guideSectionRequest={settingsGuideRequest}
            closeRequest={settingsCloseRequest + backdropSettingsCloseRequest}
          />
        )}
        {activeModal === "profile" && (
          <QuickProfileModal onClose={onClose} onToast={onToast} />
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
          canCancelGeneration={isGeneratingDiagnostic}
          generationProgress={diagnosticProgress}
          isSubmitting={isSubmittingDiagnostic}
          isConfiguring={isConfiguringDiagnostic}
          error={diagnosticError}
          passThreshold={masteryPassThreshold}
          onClose={onClose}
          onCancelGeneration={onCancelDiagnosticGeneration}
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
  onCreateWorkspace,
  onGenerate,
  initialTopic,
  onRefreshDocuments,
  onToast,
}: {
  isGenerating: boolean;
  progress: CurriculumProgress | null;
  onCancel: () => void;
  onClose: () => void;
  onCreateWorkspace: (title: string, rootDomain?: string) => Promise<void>;
  onGenerate: (
    topic: string,
    sourceDocument?: CurriculumSourceDocument
  ) => Promise<void>;
  initialTopic: string;
  onRefreshDocuments: () => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const [creationMode, setCreationMode] = useState<"manual" | "ai">("ai");
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const [rootDomain, setRootDomain] = useState("");
  const [topic, setTopic] = useState(initialTopic);
  const [sourceDocument, setSourceDocument] =
    useState<CurriculumSourceDocument | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const handleClose = () => {
    if (isGenerating && progress?.phase === "Saving curriculum…") return;
    if (isGenerating) onCancel();
    onClose();
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      handleClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isGenerating, progress?.phase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isGenerating || isImporting) return;
    try {
      if (creationMode === "manual") {
        await onCreateWorkspace(workspaceTitle, rootDomain);
        return;
      }
      if (!topic.trim() && !sourceDocument) return;
      const goal =
        topic.trim() ||
        `Create a workspace based on ${sourceDocument?.name ?? "the uploaded document"}`;
      await onGenerate(goal, sourceDocument ?? undefined);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePickSource = async () => {
    setIsImporting(true);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Course Documents", extensions: ["pdf", "md", "txt"] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const result = await ingestLocalFilePath(selected, null, true);
      if (!result.extractedText) {
        throw new Error(`No readable text was found in "${result.document.file_name}".`);
      }
      setSourceDocument({
        name: result.document.file_name,
        text: result.extractedText,
      });
      await onRefreshDocuments();
      onToast(`Loaded ${result.document.file_name} for workspace generation.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-workspace-title"
      className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-[var(--color-ink)] shadow-[0_24px_70px_rgba(27,39,47,0.2)]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-bold text-[var(--color-ink)]">
          <Layers className="h-5 w-5 text-[var(--color-accent)]" />
          <span id="create-workspace-title">Create a Workspace</span>
        </div>
        <button
          type="button"
          disabled={isGenerating && progress?.phase === "Saving curriculum…"}
          onClick={handleClose}
          className="rounded-lg p-1 text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] disabled:opacity-40"
          aria-label="Close create workspace dialog"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--color-muted)]">
        Start with an empty concept map or have AI draft a learning path for you.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div
          className="grid grid-cols-2 gap-1 rounded-xl bg-[var(--color-panel-subtle)] p-1"
          role="group"
          aria-label="Workspace creation method"
        >
          <button
            type="button"
            aria-pressed={creationMode === "manual"}
            disabled={isGenerating || isImporting}
            onClick={() => setCreationMode("manual")}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
              creationMode === "manual"
                ? "bg-[var(--color-panel)] text-[var(--color-accent)] shadow-sm"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            Start manually
          </button>
          <button
            type="button"
            aria-pressed={creationMode === "ai"}
            disabled={isGenerating || isImporting}
            onClick={() => setCreationMode("ai")}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
              creationMode === "ai"
                ? "bg-[var(--color-panel)] text-[var(--color-accent)] shadow-sm"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            Generate with AI
          </button>
        </div>
        {isGenerating && (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-ink)]">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
              {progress?.phase ?? "Drafting prerequisite structure…"}
            </div>
            {progress?.nodeTitles.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {progress.nodeTitles.map((title) => (
                  <span
                    key={title}
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-[10px] text-[var(--color-muted)]"
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
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
              >
                <X className="h-3 w-3" />
                Stop generation
              </button>
            )}
          </div>
        )}
        {creationMode === "manual" ? (
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-[var(--color-ink)]">
              Workspace name
              <input
                autoFocus
                value={workspaceTitle}
                onChange={(event) => setWorkspaceTitle(event.target.value)}
                maxLength={120}
                required
                placeholder="e.g. Introduction to Architecture"
                className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-canvas)] p-3 text-sm font-normal text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)]"
              />
            </label>
            <label className="block text-xs font-semibold text-[var(--color-ink)]">
              Subject{" "}
              <span className="font-normal text-[var(--color-muted)]">
                (optional)
              </span>
              <input
                value={rootDomain}
                onChange={(event) => setRootDomain(event.target.value)}
                maxLength={120}
                placeholder="e.g. Architecture"
                className="mt-1.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-canvas)] p-3 text-sm font-normal text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)]"
              />
            </label>
            <p className="text-[11px] leading-5 text-[var(--color-muted)]">
              You’ll start with a blank graph. Add concepts and connect their
              prerequisites as you go.
            </p>
          </div>
        ) : (
          <>
            <textarea
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Describe a subject or learning goal, e.g. Fundamentals of architecture"
              className="w-full select-text rounded-xl border border-[var(--color-border)] bg-[var(--color-canvas)] p-3 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)]"
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={isGenerating || isImporting}
                  onClick={() => void handlePickSource()}
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)] disabled:opacity-50"
                >
                  <FileUp className="h-4 w-4" />
                  {isImporting
                    ? "Reading document…"
                    : "Import syllabus / document"}
                </button>
                {sourceDocument && (
                  <div className="truncate text-right text-xs text-[var(--color-muted)]">
                    Using {sourceDocument.name}
                    <button
                      type="button"
                      onClick={() => setSourceDocument(null)}
                      className="ml-2 font-semibold text-[var(--color-accent)] hover:underline"
                      aria-label={`Remove ${sourceDocument.name}`}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={isGenerating && progress?.phase === "Saving curriculum…"}
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              isGenerating ||
              isImporting ||
              (creationMode === "manual"
                ? !workspaceTitle.trim()
                : !topic.trim() && !sourceDocument)
            }
            className="flex items-center gap-2 rounded-lg bg-[var(--color-accent-button)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
          >
            {isGenerating
              ? "Generating workspace…"
              : creationMode === "manual"
                ? "Create workspace"
                : "Generate workspace"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ReviewQueueModal({
  workspaceId,
  selectedNodeId,
  nodes,
  dueCards,
  onLoadFlashcards,
  onGenerateFlashcardsForTopic,
  onCreateFlashcard,
  onEditFlashcard,
  onRemoveFlashcard,
  onGrade,
  onToast,
  onClose,
}: {
  workspaceId: string | null;
  selectedNodeId: string | null;
  nodes: GraphNode[];
  dueCards: DueFlashcard[];
  onLoadFlashcards: (workspaceId: string) => Promise<WorkspaceFlashcard[]>;
  onGenerateFlashcardsForTopic: (
    nodeId: string,
    topic: string
  ) => Promise<WorkspaceFlashcard[]>;
  onCreateFlashcard: (
    nodeId: string,
    front: string,
    back: string
  ) => Promise<WorkspaceFlashcard>;
  onEditFlashcard: (
    card: WorkspaceFlashcard,
    front: string,
    back: string
  ) => Promise<WorkspaceFlashcard>;
  onRemoveFlashcard: (card: WorkspaceFlashcard) => Promise<void>;
  onGrade: (card: DueFlashcard, grade: ReviewGrade) => Promise<void>;
  onToast: (msg: string) => void;
  onClose: () => void;
}) {
  const [activeView, setActiveView] = useState<"study" | "library">("study");
  const [revealed, setRevealed] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [isGrading, setIsGrading] = useState(false);
  const [libraryCards, setLibraryCards] = useState<WorkspaceFlashcard[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editingCard, setEditingCard] = useState<WorkspaceFlashcard | null>(
    null
  );
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );
  const [isSpeakingCard, setIsSpeakingCard] = useState(false);
  const [formNodeId, setFormNodeId] = useState(nodes[0]?.id ?? "");
  const [frontDraft, setFrontDraft] = useState("");
  const [backDraft, setBackDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSavingCard, setIsSavingCard] = useState(false);
  const [isAiGeneratorOpen, setIsAiGeneratorOpen] = useState(false);
  const [aiNodeId, setAiNodeId] = useState(
    selectedNodeId ?? nodes[0]?.id ?? ""
  );
  const [aiTopic, setAiTopic] = useState("");
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiGenerationError, setAiGenerationError] = useState<string | null>(
    null
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const isGradingRef = useRef(false);
  const current = dueCards[0];

  useEffect(() => {
    stopSpeaking();
    setIsSpeakingCard(false);
  }, [current?.id, revealed]);

  useEffect(() => {
    return () => stopSpeaking();
  }, []);
  const totalCards = reviewedCount + dueCards.length;
  const progressPercent = totalCards
    ? Math.round((reviewedCount / totalCards) * 100)
    : 0;
  const availableNodes = nodes.filter((node) => !node.archived_at);
  const filteredCards = libraryCards.filter((card) => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return (
      !query ||
      card.front.toLocaleLowerCase().includes(query) ||
      card.back.toLocaleLowerCase().includes(query) ||
      card.node_title.toLocaleLowerCase().includes(query)
    );
  });

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      setLibraryCards([]);
      return;
    }

    let isCurrent = true;
    setIsLoadingLibrary(true);
    setLibraryError(null);
    onLoadFlashcards(workspaceId)
      .then((cards) => {
        if (isCurrent) setLibraryCards(cards);
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setLibraryError(
            error instanceof Error ? error.message : String(error)
          );
        }
      })
      .finally(() => {
        if (isCurrent) setIsLoadingLibrary(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [workspaceId, onLoadFlashcards]);

  const handleRate = async (grade: ReviewGrade) => {
    if (!current || isGradingRef.current) return;
    isGradingRef.current = true;
    setIsGrading(true);
    try {
      await onGrade(current, grade);
      setReviewedCount((count) => count + 1);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setRevealed(false);
      isGradingRef.current = false;
      setIsGrading(false);
    }
  };

  useEffect(() => {
    if (activeView !== "study" || !current) return;

    const handleStudyKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditingText =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          Boolean(
            target.closest(
              "input, textarea, select, [contenteditable='true']"
            )
          ));
      if (isEditingText) return;

      if (event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        if (!revealed) setRevealed(true);
      } else if (revealed && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const gradeByKey: Record<string, ReviewGrade> = {
          "1": 0,
          "2": 1,
          "3": 2,
          "4": 3,
        };
        void handleRate(gradeByKey[event.key]);
      }
    };

    window.addEventListener("keydown", handleStudyKeyDown);
    return () => window.removeEventListener("keydown", handleStudyKeyDown);
  }, [activeView, current, handleRate, revealed]);

  const startCreating = () => {
    setEditingCard(null);
    setIsCreating(true);
    setFormNodeId(availableNodes[0]?.id ?? "");
    setFrontDraft("");
    setBackDraft("");
    setFormError(null);
    setConfirmingDeleteId(null);
  };

  const startEditing = (card: WorkspaceFlashcard) => {
    setIsCreating(false);
    setEditingCard(card);
    setFormNodeId(card.node_id);
    setFrontDraft(card.front);
    setBackDraft(card.back);
    setFormError(null);
    setConfirmingDeleteId(null);
  };

  const retryLibraryLoad = () => {
    if (!workspaceId) return;
    setIsLoadingLibrary(true);
    setLibraryError(null);
    onLoadFlashcards(workspaceId)
      .then(setLibraryCards)
      .catch((error: unknown) =>
        setLibraryError(error instanceof Error ? error.message : String(error))
      )
      .finally(() => setIsLoadingLibrary(false));
  };

  const closeEditor = () => {
    setIsCreating(false);
    setEditingCard(null);
    setFormError(null);
  };

  const handleSaveCard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const front = frontDraft.trim();
    const back = backDraft.trim();
    if (!front || !back) {
      setFormError("Add both a prompt and an answer before saving.");
      return;
    }
    if (!editingCard && !formNodeId) {
      setFormError("Choose a lesson for this card.");
      return;
    }

    setIsSavingCard(true);
    setFormError(null);
    try {
      const savedCard = editingCard
        ? await onEditFlashcard(editingCard, front, back)
        : await onCreateFlashcard(formNodeId, front, back);
      setLibraryCards((cards) =>
        editingCard
          ? cards.map((card) =>
              card.id === savedCard.id ? savedCard : card
            )
          : [...cards, savedCard].sort((a, b) =>
              a.node_title.localeCompare(b.node_title)
            )
      );
      closeEditor();
      onToast(editingCard ? "Flashcard updated." : "Flashcard added.");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingCard(false);
    }
  };

  const handleRemoveCard = async (card: WorkspaceFlashcard) => {
    try {
      await onRemoveFlashcard(card);
      setLibraryCards((cards) => cards.filter((item) => item.id !== card.id));
      setConfirmingDeleteId(null);
      onToast("Flashcard removed.");
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  const handleGenerateAiFlashcards = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    if (!aiNodeId || isGeneratingAi) return;
    setIsGeneratingAi(true);
    setAiGenerationError(null);
    try {
      const generated = await onGenerateFlashcardsForTopic(aiNodeId, aiTopic);
      setLibraryCards((cards) =>
        [...cards, ...generated].sort((a, b) =>
          a.node_title.localeCompare(b.node_title)
        )
      );
      setAiTopic("");
      setIsAiGeneratorOpen(false);
      onToast(`Generated ${generated.length} flashcards from the lesson and matching notes.`);
    } catch (error) {
      setAiGenerationError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setIsGeneratingAi(false);
    }
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        document.querySelector(
          "[data-confirm-delete], [data-exit-confirmation]"
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (isCreating || editingCard) closeEditor();
      else onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [editingCard, isCreating, onClose]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="flashcards-title"
      tabIndex={-1}
      className="flex max-h-[92vh] min-h-[min(680px,88vh)] w-full max-w-3xl flex-col overflow-hidden rounded-[24px] border border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-ink)] shadow-[0_24px_70px_rgba(27,39,47,0.2)] outline-none"
    >
      <header className="border-b border-[var(--color-border)] px-5 py-4 sm:px-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <h2
                id="flashcards-title"
                className="text-lg font-bold tracking-tight text-[var(--color-ink)]"
              >
                Flashcards
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close flashcards"
            className="rounded-xl p-2 text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-3">
          <div
            role="group"
            aria-label="Flashcard activity"
            className="flex rounded-xl bg-[var(--color-panel-subtle)] p-1"
          >
            <button
              type="button"
              aria-pressed={activeView === "study"}
              onClick={() => {
                closeEditor();
                setActiveView("study");
              }}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeView === "study"
                  ? "bg-[var(--color-panel)] text-[var(--color-ink)] shadow-sm"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              Study
            </button>
            <button
              type="button"
              aria-pressed={activeView === "library"}
              onClick={() => setActiveView("library")}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeView === "library"
                  ? "bg-[var(--color-panel)] text-[var(--color-ink)] shadow-sm"
                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              Library
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7 sm:py-5">
        {activeView === "study" ? (
          <>
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-[var(--color-muted)]">
                <span>
                  {current
                    ? `Card ${reviewedCount + 1} of ${totalCards}`
                    : reviewedCount
                      ? "Session progress"
                      : "Ready when you are"}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Flashcard session progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
                className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]"
              >
                <div
                  className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {!current ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-panel-subtle)] px-6 py-8 text-center">
                <div className="rounded-2xl bg-[var(--color-success)]/10 p-3 text-[var(--color-success)]">
                  <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
                </div>
                <h3 className="mt-3 text-lg font-bold text-[var(--color-ink)]">
                  {reviewedCount > 0
                    ? "Nice work. Session complete."
                    : "You’re all caught up"}
                </h3>
                <p className="mt-1 max-w-md text-sm leading-5 text-[var(--color-muted)]">
                  {reviewedCount > 0
                    ? `You studied ${reviewedCount} card${reviewedCount === 1 ? "" : "s"}.`
                    : "No cards are due right now."}
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveView("library")}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2.5 text-sm font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
                  >
                    Browse my cards
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveView("library");
                      startCreating();
                    }}
                    disabled={availableNodes.length === 0}
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--color-accent-foreground)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add a card
                  </button>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="max-w-[60%] truncate rounded-full border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--color-muted)]">
                    {current.node_title}
                  </span>
                  <div className="flex items-center gap-1">
                    {isTtsSupported() && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isSpeakingCard) {
                            stopSpeaking();
                            setIsSpeakingCard(false);
                            return;
                          }
                          const textToRead = revealed
                            ? `${current.front}. Answer: ${current.back}`
                            : current.front;
                          speakWithAppVoice(textToRead, {
                            onStart: () => setIsSpeakingCard(true),
                            onEnd: () => setIsSpeakingCard(false),
                            onError: (msg) => {
                              setIsSpeakingCard(false);
                              onToast(msg);
                            },
                          });
                        }}
                        aria-pressed={isSpeakingCard}
                        aria-label={
                          isSpeakingCard ? "Stop reading card" : "Read card aloud"
                        }
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                          isSpeakingCard
                            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                            : "text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
                        }`}
                      >
                        {isSpeakingCard ? (
                          <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {isSpeakingCard ? "Stop" : "Listen"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        startEditing(current);
                        setActiveView("library");
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit card
                    </button>
                  </div>
                </div>
                <div className="relative min-h-[260px] overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-6 sm:p-8">
                  <div className="absolute left-0 top-0 h-1 w-full bg-[var(--color-accent)]/70" />
                  <div className="mb-4">
                    <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-accent)]">
                      {revealed ? "Answer" : "Prompt"}
                    </span>
                  </div>
                  <RichContent className="prose prose-base max-w-none select-text font-semibold leading-8 text-[var(--color-ink)]">
                    {current.front}
                  </RichContent>
                  {revealed && (
                    <RichContent className="prose prose-base mt-7 max-w-none select-text border-t border-[var(--color-border)] pt-6 leading-7 text-[var(--color-ink)]">
                      {current.back}
                    </RichContent>
                  )}
                </div>

                {!revealed ? (
                  <button
                    type="button"
                    onClick={() => setRevealed(true)}
                    aria-keyshortcuts="Space"
                    className="mt-4 w-full rounded-2xl bg-[var(--color-accent)] py-3.5 text-sm font-bold text-[var(--color-accent-foreground)] transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                  >
                    Show answer
                    <span className="ml-2 text-xs font-medium opacity-80">
                      Space
                    </span>
                  </button>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <button
                        type="button"
                        disabled={isGrading}
                        onClick={() => void handleRate(0)}
                        aria-keyshortcuts="1"
                        aria-label="Again"
                        className="flex items-center justify-center rounded-2xl border border-[var(--color-warning)]/70 bg-[var(--color-warning)]/20 px-2 py-4 text-sm font-semibold text-[var(--color-ink)] transition hover:brightness-95 disabled:opacity-60"
                      >
                        Again
                      </button>
                      <button
                        type="button"
                        disabled={isGrading}
                        onClick={() => void handleRate(1)}
                        aria-keyshortcuts="2"
                        aria-label="Hard"
                        className="flex items-center justify-center rounded-2xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2 py-4 text-sm font-semibold text-[var(--color-ink)] transition hover:brightness-95 disabled:opacity-60"
                      >
                        Hard
                      </button>
                      <button
                        type="button"
                        disabled={isGrading}
                        onClick={() => void handleRate(2)}
                        aria-keyshortcuts="3"
                        aria-label="Good"
                        className="flex items-center justify-center rounded-2xl border border-[var(--color-accent)]/70 bg-[var(--color-accent-soft)] px-2 py-4 text-sm font-semibold text-[var(--color-ink)] transition hover:brightness-95 disabled:opacity-60"
                      >
                        Good
                      </button>
                      <button
                        type="button"
                        disabled={isGrading}
                        onClick={() => void handleRate(3)}
                        aria-keyshortcuts="4"
                        aria-label="Easy"
                        className="flex items-center justify-center rounded-2xl border border-[var(--color-success)]/70 bg-[var(--color-success)]/20 px-2 py-4 text-sm font-semibold text-[var(--color-ink)] transition hover:brightness-95 disabled:opacity-60"
                      >
                        Easy
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="mx-auto max-w-2xl">
            {isCreating || editingCard ? (
              <form onSubmit={handleSaveCard} className="space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-[var(--color-ink)]">
                      {editingCard ? "Edit flashcard" : "Create a flashcard"}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={closeEditor}
                    aria-label="Cancel editing"
                    className="rounded-lg p-2 text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                {editingCard ? (
                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-4 py-3">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted)]">
                      Lesson
                    </span>
                    <span className="mt-1 block text-sm font-semibold text-[var(--color-ink)]">
                      {editingCard.node_title}
                    </span>
                  </div>
                ) : (
                  <label className="block text-sm font-semibold text-[var(--color-ink)]">
                    Lesson
                    <select
                      value={formNodeId}
                      onChange={(event) => setFormNodeId(event.target.value)}
                      className="mt-2 block w-full rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel)] px-3 py-2.5 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
                    >
                      {availableNodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block text-sm font-semibold text-[var(--color-ink)]">
                  Front · prompt
                  <textarea
                    autoFocus
                    rows={4}
                    value={frontDraft}
                    onChange={(event) => setFrontDraft(event.target.value)}
                    placeholder="What do you want to remember?"
                    className="mt-2 block w-full resize-y rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel)] px-4 py-3 text-sm font-normal leading-6 text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
                  />
                </label>
                <label className="block text-sm font-semibold text-[var(--color-ink)]">
                  Back · answer
                  <textarea
                    rows={5}
                    value={backDraft}
                    onChange={(event) => setBackDraft(event.target.value)}
                    placeholder="Write the answer in your own words."
                    className="mt-2 block w-full resize-y rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel)] px-4 py-3 text-sm font-normal leading-6 text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
                  />
                </label>
                {formError && (
                  <p role="alert" className="text-sm font-medium text-rose-700">
                    {formError}
                  </p>
                )}
                <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
                  <button
                    type="button"
                    onClick={closeEditor}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSavingCard ||
                      (!editingCard && availableNodes.length === 0)
                    }
                    className="rounded-xl bg-[var(--color-accent)] px-5 py-2.5 text-sm font-bold text-[var(--color-accent-foreground)] transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isSavingCard
                      ? "Saving…"
                      : editingCard
                        ? "Save changes"
                        : "Add flashcard"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-[var(--color-ink)]">
                      Your cards
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={startCreating}
                      disabled={availableNodes.length === 0}
                      className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2.5 text-xs font-bold transition hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Add card
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAiGeneratorOpen((open) => !open);
                        setAiGenerationError(null);
                      }}
                      disabled={availableNodes.length === 0}
                      className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-3 py-2.5 text-xs font-bold text-[var(--color-accent-foreground)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      Generate with AI
                    </button>
                  </div>
                </div>
                {isAiGeneratorOpen && (
                  <form
                    onSubmit={(event) => void handleGenerateAiFlashcards(event)}
                    className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="text-[11px] font-semibold">
                        Lesson
                        <select
                          value={aiNodeId}
                          onChange={(event) => setAiNodeId(event.target.value)}
                          className="mt-1 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-2 text-xs"
                        >
                          {availableNodes.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.title}
                              {node.is_hydrated === 1 ? "" : " · lesson not generated"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-[11px] font-semibold">
                        Focus topic <span className="font-normal text-[var(--color-muted)]">(optional)</span>
                        <input
                          value={aiTopic}
                          onChange={(event) => setAiTopic(event.target.value)}
                          maxLength={160}
                          placeholder="e.g. eigenvalues"
                          className="mt-1 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-2 text-xs"
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-[var(--color-muted)]">
                      Uses the lesson and searches this workspace’s notes for the topic.
                    </p>
                    {aiGenerationError && (
                      <p role="alert" className="mt-2 text-[11px] text-rose-700">
                        {aiGenerationError}
                      </p>
                    )}
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={isGeneratingAi}
                        onClick={() => setIsAiGeneratorOpen(false)}
                        className="rounded-lg px-3 py-2 text-[11px] font-semibold text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isGeneratingAi || !aiNodeId}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[11px] font-bold text-[var(--color-accent-foreground)] disabled:opacity-50"
                      >
                        {isGeneratingAi ? (
                          <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        {isGeneratingAi ? "Generating…" : "Generate cards"}
                      </button>
                    </div>
                  </form>
                )}
                <label className="relative mb-4 block">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search cards"
                    aria-label="Search flashcards"
                    className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] py-2.5 pl-10 pr-3 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
                  />
                </label>
                {libraryError && (
                  <div
                    role="alert"
                    className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                  >
                    {libraryError}
                    <button
                      type="button"
                      onClick={retryLibraryLoad}
                      className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-bold transition hover:bg-rose-100"
                    >
                      Try again
                    </button>
                  </div>
                )}
                {isLoadingLibrary ? (
                  <div className="py-16 text-center text-sm text-[var(--color-muted)]">
                    Loading your cards…
                  </div>
                ) : libraryError ? null : filteredCards.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-panel-subtle)] px-5 py-12 text-center">
                    <Layers
                      className="mx-auto h-8 w-8 text-[var(--color-muted)]"
                      aria-hidden="true"
                    />
                    <h4 className="mt-3 font-bold text-[var(--color-ink)]">
                      {libraryCards.length
                        ? "No cards match that search"
                        : "Your deck starts here"}
                    </h4>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {libraryCards.length
                        ? "Try a different prompt, answer, or lesson title."
                        : "Create a card for an idea you want to remember."}
                    </p>
                    {libraryCards.length === 0 && (
                      <button
                        type="button"
                        onClick={startCreating}
                        disabled={availableNodes.length === 0}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-2.5 text-sm font-bold text-[var(--color-accent-foreground)] transition hover:brightness-95 disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Create your first card
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredCards.map((card) => (
                      <article
                        key={card.id}
                        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3 transition hover:border-[var(--color-border-strong)]"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <span className="inline-flex max-w-full truncate rounded-full bg-[var(--color-panel-subtle)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-muted)]">
                              {card.node_title}
                            </span>
                            <RichContent className="prose prose-sm mt-2 max-w-none font-semibold leading-6 text-[var(--color-ink)]">
                              {card.front}
                            </RichContent>
                            <RichContent className="prose prose-sm mt-1 max-h-16 overflow-hidden max-w-none leading-5 text-[var(--color-muted)]">
                              {card.back}
                            </RichContent>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEditing(card)}
                              aria-label={`Edit card: ${card.front}`}
                              className="rounded-lg p-2 text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
                            >
                              <Pencil
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmingDeleteId(
                                  confirmingDeleteId === card.id
                                    ? null
                                    : card.id
                                )
                              }
                              aria-label={`Remove card: ${card.front}`}
                              className="rounded-lg p-2 text-[var(--color-muted)] transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-600"
                            >
                              <Trash2
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </button>
                          </div>
                        </div>
                        {confirmingDeleteId === card.id && (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-3 py-2.5">
                            <p className="text-xs font-medium text-[var(--color-ink)]">
                              Remove this card permanently?
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(null)}
                                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
                              >
                                Keep it
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRemoveCard(card)}
                                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-700"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
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
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isCompleting) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isCompleting, onClose]);

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="completion-prompt-title"
      className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-[var(--color-ink)] shadow-[0_24px_70px_rgba(27,39,47,0.2)]"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-[var(--color-panel-subtle)] p-2 text-[var(--color-accent)]">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="completion-prompt-title" className="text-base font-bold">Ready to complete this module?</h3>
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
  const [documentToDelete, setDocumentToDelete] = useState<{
    document: StoredDocument;
    chunkCount: number;
  } | null>(null);
  const [preparingDeleteId, setPreparingDeleteId] = useState<string | null>(
    null
  );
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [searchResults, setSearchResults] = useState<RetrievedChunk[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchRequestId = useRef(0);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isIngesting) return;
      if (
        document.querySelector(
          "[data-confirm-delete], [data-exit-confirmation]"
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (documentToDelete) setDocumentToDelete(null);
      else onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [documentToDelete, isIngesting, onClose]);

  useEffect(() => {
    const requestId = ++searchRequestId.current;
    if (!debouncedQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    void searchVaultFts(debouncedQuery, 8, workspaceId ?? undefined)
      .then((results) => {
        if (requestId === searchRequestId.current) setSearchResults(results);
      })
      .catch((error: unknown) => {
        if (requestId === searchRequestId.current) {
          onToast(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (requestId === searchRequestId.current) setIsSearching(false);
      });

    return () => {
      searchRequestId.current += 1;
    };
  }, [debouncedQuery, onToast, workspaceId]);

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
          onToast(
            `Already indexed and available here: ${res.document.file_name}`
          );
        } else {
          onToast(`Added ${res.document.file_name} (${res.chunkCount} searchable sections)`);
        }
      }
      await onRefresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsIngesting(false);
    }
  };

  const requestRemoveDocument = async (document: StoredDocument) => {
    if (preparingDeleteId) return;
    setPreparingDeleteId(document.id);
    try {
      const chunkCount = await countDocumentChunks(document.id);
      setDocumentToDelete({ document, chunkCount });
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparingDeleteId(null);
    }
  };

  const confirmRemoveDocument = async () => {
    if (!documentToDelete) return;
    await onRemove(documentToDelete.document.id);
    onToast(
      `Removed ${documentToDelete.document.file_name} from the local vault.`
    );
    void onRefresh().catch((error: unknown) =>
      onToast(error instanceof Error ? error.message : String(error))
    );
  };

  return (
    <>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-vault-title"
      className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e1dfd9] bg-white p-6 shadow-[0_24px_70px_rgba(27,39,47,0.2)]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-base font-bold text-[#2c414f]">
          <Layers className="h-5 w-5 text-[#527a91]" />
          <span id="document-vault-title">Document Vault</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close document vault"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-[#f3f2ee] hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-slate-600">
        Save PDFs, Markdown, or text notes on your device for instant full-text search.
      </p>

      <label className="mt-3 flex items-center gap-2 rounded-lg border border-[#dedfdc] bg-[#fbfaf8] px-3 py-2 text-slate-500">
        <Search className="h-3.5 w-3.5" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search indexed notes"
          className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
        />
        {isSearching && (
          <span className="text-[10px]" role="status">Searching…</span>
        )}
      </label>

      {debouncedQuery.trim() && (
        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
          {searchResults.map((result) => (
            <article
              key={result.chunk_id}
              className="rounded-lg border border-[#e5e5e0] bg-[#fbfaf8] px-3 py-2"
            >
              <p className="text-[10px] font-semibold text-slate-700">
                {result.file_name}{result.heading ? ` · ${result.heading}` : ""}
              </p>
              <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-slate-600">
                {result.content}
              </p>
            </article>
          ))}
          {!isSearching && searchResults.length === 0 && (
            <p className="py-2 text-center text-[10px] text-slate-500">
              No matching notes.
            </p>
          )}
        </div>
      )}

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
                type="button"
                disabled={preparingDeleteId !== null}
                onClick={() => void requestRemoveDocument(doc)}
                aria-label={`Delete ${doc.file_name}`}
                className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-wait disabled:opacity-50"
              >
                {preparingDeleteId === doc.id ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
    {documentToDelete && (
      <ConfirmDeleteModal
        title="Delete document?"
        itemName={documentToDelete.document.file_name}
        description="The source document and its indexed text chunks will be permanently removed from the local vault."
        impactItems={[
          {
            label: "Linked search chunks",
            value: documentToDelete.chunkCount,
          },
        ]}
        onCancel={() => setDocumentToDelete(null)}
        onConfirm={confirmRemoveDocument}
        onError={(error) =>
          onToast(error instanceof Error ? error.message : String(error))
        }
      />
    )}
    </>
  );
}

function SettingsModal({
  onToast,
  onClose,
  onQuizCacheCleared,
  onRequestExit,
  guideSectionRequest,
  closeRequest,
}: {
  onToast: (msg: string) => void;
  onClose: () => void;
  onQuizCacheCleared: () => void;
  onRequestExit: () => void;
  guideSectionRequest: {
    section: "canvas" | "ai";
    requestId: number;
  } | null;
  closeRequest: number;
}) {
  type Section =
    | "profile"
    | "ai"
    | "canvas"
    | "plugins"
    | "voice"
    | "study"
    | "vault"
    | "shortcuts";
  const sections: Array<{
    id: Section;
    title: string;
    icon: typeof Sparkles;
  }> = [
    { id: "profile", title: "Profile", icon: User },
    { id: "canvas", title: "Appearance & Themes", icon: Monitor },
    { id: "plugins", title: "Plugins", icon: Puzzle },
    { id: "voice", title: "Voice & Audio", icon: Volume2 },
    { id: "ai", title: "AI & Speed", icon: Sparkles },
    { id: "study", title: "Study", icon: GraduationCap },
    { id: "vault", title: "Vault & Data", icon: HardDrive },
    { id: "shortcuts", title: "Shortcuts", icon: Command },
  ];
  const store = useNoesisStore();
  const pluginStore = usePluginStore();
  const initial = loadAiSettings();
  const [provider, setProvider] = useState<AiProvider>(initial.provider);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [openAiPreset, setOpenAiPreset] = useState<OpenAiCompatiblePresetId>(
    initial.openAiPreset
  );
  const [openAiApiKeys, setOpenAiApiKeys] = useState<
    Partial<Record<OpenAiCompatiblePresetId, string>>
  >(initial.openAiApiKeys);
  const [openAiFastModel, setOpenAiFastModel] = useState(
    initial.openAiFastModel || initial.localModel
  );
  const [openAiSynthesisModel, setOpenAiSynthesisModel] = useState(
    initial.openAiSynthesisModel || initial.localModel
  );
  const [localBaseUrl, setLocalBaseUrl] = useState(initial.localBaseUrl);
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
  const [lessonDepth, setLessonDepth] = useState(initial.lessonDepth);
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
  const [enabledPluginIds, setEnabledPluginIds] = useState(
    pluginStore.enabledPluginIds
  );
  const [section, setSection] = useState<Section>(
    guideSectionRequest?.section ?? "canvas"
  );
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false);
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [isOpenAiKeyVisible, setIsOpenAiKeyVisible] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [availableLocalModels, setAvailableLocalModels] = useState<string[]>([]);
  const [isMaintaining, setIsMaintaining] = useState(false);
  const [quizCacheDeleteCount, setQuizCacheDeleteCount] = useState<
    number | null
  >(null);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const currentOpenAiPreset = getOpenAiPreset(openAiPreset);
  const currentOpenAiApiKey = openAiApiKeys[openAiPreset] ?? "";
  const initialDraftSnapshot = useRef<string | null>(null);
  const draftSnapshot = JSON.stringify({
    provider,
    apiKey,
    openAiPreset,
    openAiApiKeys,
    openAiFastModel,
    openAiSynthesisModel,
    localBaseUrl,
    localContextWindowTokens,
    localMaxOutputTokens,
    localTemperature,
    localTopP,
    lessonDepth,
    creativityPreset,
    fastModelSelection,
    customFastModel,
    synthesisModelSelection,
    customSynthesisModel,
    preferences,
    enabledPluginIds: [...enabledPluginIds].sort(),
  });
  if (initialDraftSnapshot.current === null) {
    initialDraftSnapshot.current = draftSnapshot;
  }
  const hasUnsavedChanges = draftSnapshot !== initialDraftSnapshot.current;

  const updateShowGuideOnStartup = (show: boolean) => {
    setPreferences((current) => ({ ...current, showAppTutorial: show }));
  };
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

  const updateAppearance = (mode: "dark" | "light", theme: AppTheme) => {
    const nextPreferences = {
      ...preferences,
      appearanceMode: mode,
      theme,
      ...(mode === "dark"
        ? { lastDarkThemeId: theme }
        : { lastLightThemeId: theme }),
    };
    setPreferences(nextPreferences);
  };

  const requestClose = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedChanges(true);
      return;
    }
    onClose();
  };

  const lastCloseRequest = useRef(closeRequest);
  useEffect(() => {
    if (lastCloseRequest.current === closeRequest) return;
    lastCloseRequest.current = closeRequest;
    requestClose();
  }, [closeRequest, hasUnsavedChanges]);

  useEffect(() => {
    if (guideSectionRequest) {
      setSection(guideSectionRequest.section);
    }
  }, [guideSectionRequest]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        document.querySelector(
          "[data-confirm-delete], [data-exit-confirmation]"
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (showUnsavedChanges) setShowUnsavedChanges(false);
      else requestClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [hasUnsavedChanges, onClose, showUnsavedChanges]);

  useEffect(() => {
    void refreshStats();
  }, []);

  useEffect(() => {
    let active = true;
    void getNativeFullscreen()
      .then((fullscreen) => {
        if (active) setIsFullscreen(fullscreen);
      })
      .catch((error: unknown) =>
        onToast(error instanceof Error ? error.message : String(error))
      );
    return () => {
      active = false;
    };
  }, [onToast]);

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
      const trimmedFastOpenAiModel =
        openAiFastModel.trim() || openAiSynthesisModel.trim();
      const trimmedSynthesisOpenAiModel =
        openAiSynthesisModel.trim() || trimmedFastOpenAiModel;
      if (
        provider === "openai-compatible" &&
        (!localBaseUrl.trim() || !trimmedFastOpenAiModel)
      ) {
        onToast("Enter a base URL and at least one model name.");
        return;
      }
      if (
        provider === "openai-compatible" &&
        currentOpenAiPreset.requiresApiKey &&
        !currentOpenAiApiKey.trim()
      ) {
        onToast(`Enter your ${currentOpenAiPreset.label} API key.`);
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
        onToast("Check the model context, token, temperature, and top-p values.");
        return;
      }
      saveAiSettings({
        provider,
        apiKey,
        fastModel,
        synthesisModel,
        creativityPreset,
        openAiPreset,
        openAiApiKeys,
        openAiFastModel: trimmedFastOpenAiModel,
        openAiSynthesisModel: trimmedSynthesisOpenAiModel,
        localBaseUrl,
        localModel: trimmedFastOpenAiModel,
        localContextWindowTokens: contextWindowValue,
        localMaxOutputTokens: outputTokenValue,
        localTemperature: temperatureValue,
        localTopP: topPValue,
        lessonDepth,
      });
      await store.setPreferences(preferences);
      pluginStore.setEnabledPluginIds(enabledPluginIds);
      onToast("Preferences saved locally.");
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSelectOpenAiPreset = (nextPresetId: OpenAiCompatiblePresetId) => {
    const nextPreset = getOpenAiPreset(nextPresetId);
    setOpenAiPreset(nextPresetId);
    if (nextPreset.defaultBaseUrl) {
      setLocalBaseUrl(nextPreset.defaultBaseUrl);
    }
    setLocalContextWindowTokens(String(nextPreset.defaultContextWindowTokens));
    setLocalMaxOutputTokens(String(nextPreset.defaultMaxOutputTokens));
    setAvailableLocalModels([]);
  };

  const handleConnectionTest = async () => {
    setIsTestingConnection(true);
    try {
      const openAiTestModel =
        openAiFastModel.trim() || openAiSynthesisModel.trim();
      await testGeminiConnection({
        provider,
        apiKey:
          provider === "gemini"
            ? apiKey.trim()
            : currentOpenAiApiKey.trim() || undefined,
        modelId: provider === "gemini" ? fastModel : openAiTestModel,
        baseUrl: localBaseUrl.trim(),
      });
      onToast(
        provider === "gemini"
          ? "Gemini connection successful."
          : `${currentOpenAiPreset.label} connection successful.`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleFetchLocalModels = async () => {
    setIsFetchingModels(true);
    try {
      const models = await fetchOpenAiModels(
        localBaseUrl,
        currentOpenAiApiKey.trim() || undefined
      );
      setAvailableLocalModels(models);
      if (models.length > 0) {
        if (!openAiFastModel.trim()) setOpenAiFastModel(models[0]);
        if (!openAiSynthesisModel.trim()) setOpenAiSynthesisModel(models[0]);
      }
      onToast(
        models.length
          ? `Found ${models.length} model${models.length === 1 ? "" : "s"}.`
          : "The endpoint returned no models."
      );
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    } finally {
      setIsFetchingModels(false);
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

  const requestClearQuizCache = async () => {
    try {
      setQuizCacheDeleteCount(await countGeneratedDiagnostics());
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    }
  };

  const confirmClearQuizCache = async () => {
    await clearGeneratedDiagnostics();
    onQuizCacheCleared();
    onToast("Generated quiz cache cleared.");
    void refreshStats();
  };

  return (
    <>
    <form
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      onSubmit={handleSave}
      className="settings-shell flex h-[min(680px,88vh)] w-full max-w-[920px] overflow-hidden rounded-2xl border border-[#e1dfd9] bg-white shadow-[0_16px_48px_rgba(27,39,47,0.14)]"
    >
      <aside className="settings-sections flex w-[218px] shrink-0 flex-col border-r border-[#e9e7e1] bg-[#f8f9f6] p-4">
        <div className="flex items-center gap-2 px-2 py-2 text-sm font-bold text-[var(--color-ink)]">
          <KeyRound className="h-4 w-4 text-[var(--color-ink)]" />
          <span id="settings-dialog-title">Settings</span>
        </div>
        <nav aria-label="Settings sections" className="mt-4 space-y-1">
          {sections.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-guide={
                id === "ai"
                  ? "settings-ai"
                  : id === "canvas"
                    ? "settings-appearance"
                    : undefined
              }
              aria-pressed={section === id}
              onClick={() => setSection(id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition ${
                section === id
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm ring-1 ring-[var(--color-accent)]"
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
            <h2 className="text-sm font-bold text-[var(--color-ink)]">
              {sections.find((item) => item.id === section)?.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-[#f3f2ee] hover:text-slate-700"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 select-text">
          {section === "profile" && (
            <section className="space-y-4">
              <div className="rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] p-4">
                <h3 className="text-xs font-semibold text-slate-800">
                  Your study profile
                </h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Used to greet you on the Dashboard and help your AI tutor address you naturally. Stored only on this device.
                </p>
                <div className="mt-3 space-y-3">
                  <label className="block">
                    <span className="text-[11px] font-semibold text-slate-700">
                      Your name
                    </span>
                    <input
                      type="text"
                      value={preferences.profileName}
                      maxLength={80}
                      onChange={(event) =>
                        setPreferences((current) => ({
                          ...current,
                          profileName: event.target.value,
                          profilePromptSeen: true,
                        }))
                      }
                      placeholder="e.g. Alex"
                      className={settingsSelectClass}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-slate-700">
                      What are you studying? (optional)
                    </span>
                    <input
                      type="text"
                      value={preferences.profileFocus}
                      maxLength={120}
                      onChange={(event) =>
                        setPreferences((current) => ({
                          ...current,
                          profileFocus: event.target.value,
                          profilePromptSeen: true,
                        }))
                      }
                      placeholder="e.g. Computer Science, Pre-Med, Spanish"
                      className={settingsSelectClass}
                    />
                  </label>
                </div>
              </div>
            </section>
          )}

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
                  <option value="gemini">Google Gemini (Default)</option>
                  <option value="openai-compatible">
                    OpenAI-Compatible (Cloud &amp; Local)
                  </option>
                </select>
              </SettingsField>
              {provider === "gemini" ? (
                <>
                  <p className="rounded-lg bg-[var(--color-accent-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--color-ink)]">
                    Free account? Use Flash-Lite.
                  </p>
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
                        className="rounded-lg border border-[#d7e3e5] bg-[#f4f8f7] px-3 text-xs font-semibold text-[var(--color-ink)] hover:bg-[#eaf2f0] disabled:opacity-50"
                      >
                        {isTestingConnection ? "Testing…" : "Test"}
                      </button>
                    </div>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex text-[11px] font-semibold text-[var(--color-accent)] hover:underline"
                    >
                      Get an API key from Google AI Studio
                    </a>
                  </section>

                  <details className="disclosure-chevron settings-disclosure rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-4">
                    <summary className="cursor-pointer py-3 text-xs font-semibold text-[var(--color-ink)]">
                      Model selection
                    </summary>
                    <div className="space-y-5 border-t border-[var(--color-border)] py-4">
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
                    </div>
                  </details>
                </>
              ) : (
                <>
                  <SettingsField label="Provider preset">
                    <select
                      value={openAiPreset}
                      onChange={(event) =>
                        handleSelectOpenAiPreset(
                          event.target.value as OpenAiCompatiblePresetId
                        )
                      }
                      className={settingsDropdownClass}
                    >
                      <optgroup label="Cloud APIs">
                        {OPENAI_COMPATIBLE_PRESETS.filter(
                          (preset) => preset.kind === "cloud"
                        ).map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Local Servers">
                        {OPENAI_COMPATIBLE_PRESETS.filter(
                          (preset) => preset.kind === "local"
                        ).map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </optgroup>
                      {OPENAI_COMPATIBLE_PRESETS.filter(
                        (preset) => preset.kind === "custom"
                      ).map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </SettingsField>

                  <section>
                    <h3 className="text-xs font-semibold text-slate-800">
                      {currentOpenAiPreset.label} API key{" "}
                      {!currentOpenAiPreset.requiresApiKey && (
                        <span className="font-normal text-slate-500">
                          (optional)
                        </span>
                      )}
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Stored locally per provider preset; sent only to your configured endpoint.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <input
                        type={isOpenAiKeyVisible ? "text" : "password"}
                        value={currentOpenAiApiKey}
                        onChange={(event) =>
                          setOpenAiApiKeys((prev) => ({
                            ...prev,
                            [openAiPreset]: event.target.value,
                          }))
                        }
                        placeholder={
                          currentOpenAiPreset.requiresApiKey
                            ? `Paste ${currentOpenAiPreset.label} API key`
                            : "Optional API key (leave blank for local servers)"
                        }
                        autoComplete="off"
                        className="min-w-0 flex-1 rounded-lg border border-[#dedfdc] bg-[#fbfaf8] px-3 py-2.5 text-xs text-slate-800 focus:border-[#6f9ab6] focus:outline-none focus:ring-2 focus:ring-[#d9e7ef]"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setIsOpenAiKeyVisible((visible) => !visible)
                        }
                        className="rounded-lg border border-[#dedfdc] px-3 text-slate-600 hover:bg-[#f8f7f4]"
                        aria-label={
                          isOpenAiKeyVisible ? "Hide API key" : "Show API key"
                        }
                      >
                        {isOpenAiKeyVisible ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={
                          isTestingConnection ||
                          (!openAiFastModel.trim() &&
                            !openAiSynthesisModel.trim()) ||
                          !localBaseUrl.trim() ||
                          (currentOpenAiPreset.requiresApiKey &&
                            !currentOpenAiApiKey.trim())
                        }
                        onClick={() => void handleConnectionTest()}
                        className="rounded-lg border border-[#d7e3e5] bg-[#f4f8f7] px-3 text-xs font-semibold text-[var(--color-ink)] hover:bg-[#eaf2f0] disabled:opacity-50"
                      >
                        {isTestingConnection ? "Testing…" : "Test"}
                      </button>
                    </div>
                    {currentOpenAiPreset.keyUrl && (
                      <a
                        href={currentOpenAiPreset.keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex text-[11px] font-semibold text-[var(--color-accent)] hover:underline"
                      >
                        Get an API key from {currentOpenAiPreset.label}
                      </a>
                    )}
                  </section>

                  <SettingsField label="Base URL">
                    <input
                      value={localBaseUrl}
                      onChange={(event) => setLocalBaseUrl(event.target.value)}
                      placeholder={
                        currentOpenAiPreset.defaultBaseUrl ||
                        "https://api.example.com/v1"
                      }
                      className={settingsSelectClass}
                    />
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">
                      {currentOpenAiPreset.hint ??
                        "Enter the base URL, /v1 URL, or chat-completions URL; Noesis normalizes model discovery and chat routes."}
                    </p>
                  </SettingsField>

                  <details
                    open
                    className="disclosure-chevron settings-disclosure rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-4"
                  >
                    <summary className="cursor-pointer py-3 text-xs font-semibold text-[var(--color-ink)]">
                      Model selection
                    </summary>
                    <div className="space-y-4 border-t border-[var(--color-border)] py-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-slate-500">
                          Choose separate models for quick tasks and deep lessons.
                        </p>
                        <button
                          type="button"
                          disabled={
                            isFetchingModels ||
                            !localBaseUrl.trim() ||
                            (currentOpenAiPreset.requiresApiKey &&
                              !currentOpenAiApiKey.trim())
                          }
                          onClick={() => void handleFetchLocalModels()}
                          className="shrink-0 rounded-lg border border-[#d7e3e5] bg-[#f4f8f7] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[#eaf2f0] disabled:opacity-50"
                        >
                          {isFetchingModels ? "Fetching…" : "Detect models"}
                        </button>
                      </div>

                      <SettingsField label="Fast model">
                        <input
                          value={openAiFastModel}
                          onChange={(event) =>
                            setOpenAiFastModel(event.target.value)
                          }
                          placeholder={currentOpenAiPreset.placeholderFastModel}
                          className={settingsSelectClass}
                        />
                        {availableLocalModels.length > 0 && (
                          <select
                            value={
                              availableLocalModels.includes(openAiFastModel)
                                ? openAiFastModel
                                : ""
                            }
                            onChange={(event) =>
                              setOpenAiFastModel(event.target.value)
                            }
                            className={`${settingsDropdownClass} mt-2`}
                          >
                            <option value="">Choose a detected model…</option>
                            {availableLocalModels.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                        )}
                      </SettingsField>

                      <SettingsField label="Synthesis model">
                        <input
                          value={openAiSynthesisModel}
                          onChange={(event) =>
                            setOpenAiSynthesisModel(event.target.value)
                          }
                          placeholder={
                            currentOpenAiPreset.placeholderSynthesisModel
                          }
                          className={settingsSelectClass}
                        />
                        {availableLocalModels.length > 0 && (
                          <select
                            value={
                              availableLocalModels.includes(
                                openAiSynthesisModel
                              )
                                ? openAiSynthesisModel
                                : ""
                            }
                            onChange={(event) =>
                              setOpenAiSynthesisModel(event.target.value)
                            }
                            className={`${settingsDropdownClass} mt-2`}
                          >
                            <option value="">Choose a detected model…</option>
                            {availableLocalModels.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                        )}
                      </SettingsField>
                    </div>
                  </details>

                  <details className="disclosure-chevron settings-disclosure rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-4">
                    <summary className="cursor-pointer py-3 text-xs font-semibold text-[var(--color-ink)]">
                      Advanced inference limits
                    </summary>
                    <section className="border-t border-[var(--color-border)] py-4">
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
                  </details>
                </>
              )}
              <details className="disclosure-chevron settings-disclosure rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-4">
                <summary className="cursor-pointer py-3 text-xs font-semibold text-[var(--color-ink)]">
                  Lesson generation preferences
                </summary>
                <div className="space-y-5 border-t border-[var(--color-border)] py-4">
              <SettingsField label="Lesson length / depth">
                <select
                  value={lessonDepth}
                  onChange={(event) =>
                    setLessonDepth(
                      event.target.value as typeof lessonDepth
                    )
                  }
                  className={settingsDropdownClass}
                >
                  <option value="concise">Concise · 450–650 words</option>
                  <option value="standard">Standard · 1,000–1,500 words</option>
                  <option value="comprehensive">
                    Comprehensive · 2,000–3,200+ words
                  </option>
                </select>
              </SettingsField>
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
                </div>
              </details>
            </>
          )}

          {section === "canvas" && (
            <>
              <SettingsField label="Appearance mode">
                <SegmentedSetting
                  value={preferences.appearanceMode}
                  options={[
                    ["dark", "Dark"],
                    ["light", "Light"],
                  ]}
                  onChange={(value) => {
                    const mode = value as "dark" | "light";
                    updateAppearance(
                      mode,
                      mode === "dark"
                        ? preferences.lastDarkThemeId
                        : preferences.lastLightThemeId
                    );
                  }}
                />
              </SettingsField>
              <SettingsField label="Theme">
                <div className="grid grid-cols-2 gap-2">
                  {APP_THEME_OPTIONS.filter(
                    (theme) => theme.mode === preferences.appearanceMode
                  ).map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      aria-pressed={preferences.theme === theme.id}
                      onClick={() =>
                        updateAppearance(preferences.appearanceMode, theme.id)
                      }
                      className={`rounded-xl border p-2 text-left transition ${
                        preferences.theme === theme.id
                          ? "border-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-panel)]"
                          : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
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
                      <span
                        className={`text-[10px] font-semibold ${
                          preferences.theme === theme.id
                            ? "text-[var(--color-accent)]"
                            : "text-[var(--color-ink)]"
                        }`}
                      >
                        {theme.label}
                      </span>
                    </button>
                  ))}
                </div>
              </SettingsField>
              <SettingsField label="Font family">
                <select
                  value={preferences.fontFamily}
                  onChange={(event) =>
                    setPreferences({
                      ...preferences,
                      fontFamily: event.target.value as UserPreferences["fontFamily"],
                    })
                  }
                  className={settingsDropdownClass}
                >
                  <option value="system">System Default</option>
                  <option value="geometric">Modern Geometric</option>
                  <option value="editorial">Editorial Serif (Reading Comfort)</option>
                  <option value="hyperlegible">Atkinson Hyperlegible</option>
                  <option value="monospace">Developer Monospace</option>
                </select>
              </SettingsField>
              <SettingsField label="Reading scale">
                <SegmentedSetting
                  value={preferences.readingScale}
                  options={[
                    ["compact", "Compact 95%"],
                    ["default", "Default 100%"],
                    ["comfortable", "Comfortable 110%"],
                  ]}
                  onChange={(value) =>
                    setPreferences({
                      ...preferences,
                      readingScale: value as UserPreferences["readingScale"],
                    })
                  }
                />
              </SettingsField>
              <SettingsField label="Motion">
                <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 py-3">
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-[var(--color-ink)]">
                      Reduce motion
                    </span>
                    <span className="mt-1 block text-[11px] leading-4 text-[var(--color-muted)]">
                      Minimize animations and transitions. System motion
                      preferences are always respected.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.reduceMotion}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        reduceMotion: event.target.checked,
                      })
                    }
                    className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  />
                </label>
              </SettingsField>
              <SettingsField label="Text visibility">
                <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 py-3">
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-[var(--color-ink)]">
                      High-contrast text
                    </span>
                    <span className="mt-1 block text-[11px] leading-4 text-[var(--color-muted)]">
                      Strengthen text contrast while keeping your theme colors.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.highContrastText}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        highContrastText: event.target.checked,
                      })
                    }
                    className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  />
                </label>
              </SettingsField>
              <details className="disclosure-chevron settings-disclosure rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-4">
                <summary className="cursor-pointer py-3 text-xs font-semibold text-[var(--color-ink)]">
                  Advanced canvas and window options
                </summary>
                <div className="space-y-5 border-t border-[var(--color-border)] py-4">
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
                    className="h-4 w-4 accent-[var(--color-accent-button)]"
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
                <div className="space-y-2">
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
                      className="h-4 w-4 accent-[var(--color-accent-button)]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      void setNativeFullscreen(!isFullscreen)
                        .then(setIsFullscreen)
                        .catch((error: unknown) =>
                          onToast(error instanceof Error ? error.message : String(error))
                        )
                    }
                    className="w-full rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] px-3 py-2.5 text-left text-xs font-medium text-slate-700 transition hover:bg-white"
                  >
                    {isFullscreen ? "Exit fullscreen now" : "Enter fullscreen now"}
                  </button>
                </div>
              </SettingsField>
                </div>
              </details>
            </>
          )}

          {section === "plugins" && (
            <section className="space-y-3">
              <p className="text-[11px] leading-5 text-slate-600">
                Enable built-in workspace tools. Plugin code is bundled with
                Noesis; custom executable plugins are not supported.
              </p>
              {BUILT_IN_PLUGINS.map((plugin) => {
                const enabled = enabledPluginIds.includes(plugin.id);
                return (
                  <label
                    key={plugin.id}
                    className="flex items-start justify-between gap-4 rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] px-3 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-800">
                        {plugin.name}
                      </span>
                      <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                        {plugin.description}
                      </span>
                      {plugin.id === KOKORO_TTS_PLUGIN_ID && enabled && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            setSection("voice");
                          }}
                          className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Volume2 className="h-3 w-3" />
                          Configure &amp; download voice model
                        </button>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) => {
                        setEnabledPluginIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, plugin.id])]
                            : current.filter((id) => id !== plugin.id)
                        );
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent-button)]"
                      aria-label={`Enable ${plugin.name}`}
                    />
                  </label>
                );
              })}
            </section>
          )}

          {section === "voice" && (
            <KokoroVoiceSettings
              preferences={preferences}
              onUpdatePreferences={setPreferences}
              kokoroEnabled={enabledPluginIds.includes(KOKORO_TTS_PLUGIN_ID)}
              onToast={onToast}
            />
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
              {enabledPluginIds.includes(FLASHCARDS_PLUGIN_ID) && (
                <SettingsField label="Daily flashcard review limit">
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
              )}
              <SettingsField label="Show guide on startup">
                <label className="flex items-center justify-between rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] px-3 py-3 text-xs text-slate-700">
                  <span>Show guide on startup</span>
                  <input
                    type="checkbox"
                    checked={preferences.showAppTutorial}
                    onChange={(event) =>
                      updateShowGuideOnStartup(event.target.checked)
                    }
                    className="h-4 w-4 accent-[var(--color-accent-button)]"
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
                <StatCard label="Searchable sections" value={stats?.chunkCount} />
                <StatCard
                  label="Storage size"
                  value={
                    stats
                      ? `${(stats.databaseSizeBytes / (1024 * 1024)).toFixed(2)} MB`
                      : undefined
                  }
                />
              </div>
              <div className="rounded-xl border border-[#e7e7e1] bg-[#fbfaf8] p-4">
                <h3 className="text-xs font-semibold text-slate-800">
                  Storage & search maintenance
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
                    Rebuild search index
                  </button>
                  <button
                    type="button"
                    disabled={isMaintaining}
                    onClick={() =>
                      void runMaintenance(compactDatabase, "Storage optimized.")
                    }
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-[#dce4e5] bg-white px-2 py-2 text-[10px] font-semibold text-slate-700 hover:bg-[#f5f7f5] disabled:opacity-50"
                  >
                    <HardDrive className="h-3.5 w-3.5" />
                    Optimize storage
                  </button>
                  <button
                    type="button"
                    disabled={isMaintaining}
                    onClick={() => void requestClearQuizCache()}
                    className="col-span-2 rounded-lg border border-[#eadfda] bg-white px-2 py-2 text-[10px] font-semibold text-[var(--color-ink)] hover:bg-[#fcf7f5] disabled:opacity-50"
                  >
                    Clear generated quiz cache
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={onRequestExit}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Exit Noesis
              </button>
            </>
          )}

          {section === "shortcuts" && (
            <section className="space-y-2">
              <p className="text-[11px] leading-5 text-slate-600">
                Shortcuts work when you are not typing in a field.
              </p>
              {[
                ["F11", "Toggle fullscreen"],
                ["Ctrl + \\", "Show or hide the sidebar"],
                ["Ctrl + N", "Create a workspace"],
                ["Ctrl + ,", "Open settings"],
                ["Ctrl + Shift + F", "Toggle fullscreen"],
                ["Ctrl + Z", "Undo the last workspace edit"],
                ["Ctrl + Y / Ctrl + Shift + Z", "Redo a workspace edit"],
                ["Esc", "Close the topmost popup or dialog"],
                ["Space", "Reveal a flashcard answer"],
                ["1–4", "Rate a revealed flashcard"],
              ].map(([shortcut, action]) => (
                <div
                  key={shortcut}
                  className="flex items-center justify-between gap-4 rounded-lg border border-[#e7e7e1] bg-[#fbfaf8] px-3 py-2.5"
                >
                  <kbd className="rounded-md border border-[#dedfdc] bg-white px-2 py-1 font-mono text-[10px] font-semibold text-slate-700">
                    {shortcut}
                  </kbd>
                  <span className="text-right text-[11px] text-slate-600">
                    {action}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[#ebe8e2] px-6 py-3">
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg px-3 py-2 text-xs text-slate-600 transition hover:bg-[#f3f2ee]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--color-accent-button)] px-4 py-2 text-xs font-semibold text-[var(--color-accent-foreground)] transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-button)]"
          >
            Save preferences
          </button>
        </footer>
      </div>
    </form>
    {quizCacheDeleteCount !== null && (
      <ConfirmDeleteModal
        title="Clear generated quiz cache?"
        itemName="Generated diagnostic quizzes"
        description="Saved quiz records will be permanently removed. You can generate quizzes again when you need them."
        impactItems={[
          { label: "Cached quizzes", value: quizCacheDeleteCount },
        ]}
        onCancel={() => setQuizCacheDeleteCount(null)}
        onConfirm={confirmClearQuizCache}
        onError={(error) =>
          onToast(error instanceof Error ? error.message : String(error))
        }
      />
    )}
    {showUnsavedChanges && (
      <div
        className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setShowUnsavedChanges(false);
          }
        }}
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="unsaved-settings-title"
          className="w-full max-w-[380px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-[var(--color-ink)] shadow-2xl"
        >
          <h2
            id="unsaved-settings-title"
            className="text-sm font-semibold"
          >
            Discard unsaved changes?
          </h2>
          <p className="mt-2 text-xs leading-5 text-[var(--color-muted)]">
            Your settings will stay unchanged unless you save them.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowUnsavedChanges(false)}
              className="rounded-lg border border-[var(--color-border)] px-3.5 py-2 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[var(--color-accent-button)] px-3.5 py-2 text-xs font-semibold text-[var(--color-accent-foreground)] hover:brightness-95"
            >
              Discard changes
            </button>
          </div>
        </div>
      </div>
    )}
    </>
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
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
            value === option
              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-sm ring-1 ring-[var(--color-accent)]"
              : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function QuickProfileModal({
  onClose,
  onToast,
}: {
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const store = useNoesisStore();
  const [name, setName] = useState(store.preferences.profileName);
  const [focus, setFocus] = useState(store.preferences.profileFocus);
  const [isSaving, setIsSaving] = useState(false);

  const dismiss = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (!store.preferences.profilePromptSeen) {
        await store.setPreferences({
          ...store.preferences,
          profilePromptSeen: true,
        });
      }
    } catch {
      // Non-fatal if persistence fails on skip
    } finally {
      setIsSaving(false);
      onClose();
    }
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void dismiss();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      await store.setPreferences({
        ...store.preferences,
        profileName: name.trim(),
        profileFocus: focus.trim(),
        profilePromptSeen: true,
      });
      onToast("Profile saved.");
      onClose();
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-profile-title"
      onSubmit={(event) => void handleSubmit(event)}
      className="w-full max-w-md rounded-2xl border border-[#e1dfd9] bg-white p-6 shadow-[0_24px_70px_rgba(27,39,47,0.2)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <User className="h-4 w-4" />
          </span>
          <div>
            <h2
              id="quick-profile-title"
              className="text-base font-bold text-[#2c414f]"
            >
              Quick profile
            </h2>
            <p className="text-[11px] text-slate-500">
              Personalizes your Dashboard and AI tutor
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void dismiss()}
          aria-label="Close profile setup"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-[#f3f2ee] hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 space-y-3.5">
        <label className="block">
          <span className="text-xs font-semibold text-slate-700">
            What should Noesis call you?
          </span>
          <input
            type="text"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Alex"
            className="mt-1.5 w-full select-text rounded-xl border border-[#dedfdc] bg-[#fbfaf8] px-3.5 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-700">
            What are you studying?{" "}
            <span className="font-normal text-slate-400">(optional)</span>
          </span>
          <input
            type="text"
            maxLength={120}
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
            placeholder="e.g. Computer Science, Biology, Spanish"
            className="mt-1.5 w-full select-text rounded-xl border border-[#dedfdc] bg-[#fbfaf8] px-3.5 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]"
          />
        </label>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void dismiss()}
          className="rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-500 transition hover:bg-[#f3f2ee] hover:text-slate-700 disabled:opacity-50"
        >
          Skip for now
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-xl bg-[var(--color-accent-button)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
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
      <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
        {value ?? "…"}
      </p>
    </div>
  );
}