import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RotateCcw,
  Save,
  Sparkles,
  Square,
} from "lucide-react";
import { loadQuizPreferences, saveQuizPreferences } from "../ai/quizService";
import type { QuizBatchProgress } from "../ai/quizService";
import type { AppTheme } from "../ai/keyStore";
import type {
  QuizAnswer,
  QuizDraft,
  QuizGenerationConfig,
  QuizGradingResult,
  QuizLanguage,
  QuizQuestion,
  QuizQuestionType,
} from "../types/domain";
import { RichContent } from "./ui/RichContent";

const CodeEditor = lazy(() =>
  import("./ui/CodeEditor").then((module) => ({ default: module.CodeEditor }))
);

const FORMATS: Array<{ id: QuizQuestionType; label: string; detail: string }> = [
  { id: "mcq", label: "Multiple Choice", detail: "Fast conceptual recall" },
  { id: "open_ended", label: "Open-Ended", detail: "Explain from first principles" },
  { id: "coding", label: "Coding Challenge", detail: "Implement a solution" },
];

const LANGUAGES: Array<{ id: QuizLanguage; label: string }> = [
  { id: "auto", label: "Auto-detect from lesson" },
  { id: "C", label: "C" },
  { id: "C++", label: "C++" },
  { id: "C#", label: "C#" },
  { id: "Python", label: "Python" },
  { id: "Java", label: "Java" },
  { id: "JavaScript", label: "JavaScript" },
  { id: "TypeScript", label: "TypeScript" },
  { id: "Rust", label: "Rust" },
  { id: "SQL", label: "SQL" },
  { id: "Go", label: "Go" },
];

interface QuizItem {
  type: QuizQuestionType;
  questionIndexes: number[];
}

interface QuizArenaProps {
  nodeId: string | null;
  lessonTitle: string;
  theme: AppTheme;
  questions: QuizQuestion[];
  savedConfig: QuizGenerationConfig | null;
  savedDraft: QuizDraft;
  savedScore: number | null;
  isLoading: boolean;
  canCancelGeneration: boolean;
  generationProgress: QuizBatchProgress | null;
  isSubmitting: boolean;
  isConfiguring: boolean;
  error: string | null;
  passThreshold: number;
  onClose: () => void;
  onCancelGeneration: () => void;
  onConfigure: (nodeId: string) => void;
  onCancelConfiguration: () => void;
  onGenerate: (nodeId: string, config: QuizGenerationConfig) => Promise<void>;
  onSaveDraft: (nodeId: string, draft: QuizDraft) => Promise<void>;
  onResetAttempt: (nodeId: string) => Promise<void>;
  onSubmit: (
    nodeId: string,
    answers: Record<string, QuizAnswer>,
    languages: Record<string, QuizLanguage>
  ) => Promise<{ score: number; passed: boolean; results: QuizGradingResult[] }>;
  onToast: (message: string) => void;
}

function isAnswered(question: QuizQuestion, answer: QuizAnswer | undefined) {
  return question.type === "mcq"
    ? typeof answer === "number"
    : typeof answer === "string" && answer.trim().length > 0;
}

export function QuizArena({
  nodeId,
  lessonTitle,
  theme,
  questions,
  savedConfig,
  savedDraft,
  savedScore,
  isLoading,
  canCancelGeneration,
  generationProgress,
  isSubmitting,
  isConfiguring,
  error,
  passThreshold,
  onClose,
  onCancelGeneration,
  onConfigure,
  onCancelConfiguration,
  onGenerate,
  onSaveDraft,
  onResetAttempt,
  onSubmit,
  onToast,
}: QuizArenaProps) {
  const [config, setConfig] = useState(loadQuizPreferences);
  const answersRef = useRef<Record<string, QuizAnswer>>({
    ...savedDraft.answers,
  });
  const [answerVersion, setAnswerVersion] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(
    savedDraft.currentQuestionIndex
  );
  const [questionLanguages, setQuestionLanguages] = useState<
    Record<string, QuizLanguage>
  >(savedDraft.languageByQuestion ?? {});
  const [gradingResults, setGradingResults] = useState(
    savedDraft.results ?? []
  );
  const [score, setScore] = useState(savedScore ?? savedDraft.score ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [isComplete, setIsComplete] = useState(savedScore !== null);
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
  const [isQuestionNavOpen, setIsQuestionNavOpen] = useState(true);
  const dirtyRef = useRef(false);

  const quizItems = useMemo(() => {
    const items: QuizItem[] = [];
    let multipleChoiceItem: QuizItem | null = null;

    questions.forEach((question, index) => {
      if (question.type === "mcq") {
        if (!multipleChoiceItem) {
          multipleChoiceItem = { type: "mcq", questionIndexes: [] };
          items.push(multipleChoiceItem);
        }
        multipleChoiceItem.questionIndexes.push(index);
      } else {
        items.push({ type: question.type, questionIndexes: [index] });
      }
    });

    return items;
  }, [questions]);
  const currentItemIndex = Math.max(
    0,
    quizItems.findIndex((item) => item.questionIndexes.includes(currentIndex))
  );
  const activeItem = quizItems[currentItemIndex] ?? null;
  const activeQuestion = questions[currentIndex] ?? null;

  useEffect(() => {
    if (savedConfig) {
      setConfig(savedConfig);
      saveQuizPreferences(savedConfig);
    }
  }, [savedConfig]);

  useEffect(() => {
    answersRef.current = { ...savedDraft.answers };
    setCurrentIndex(
      Math.min(
        Math.max(0, savedDraft.currentQuestionIndex),
        Math.max(0, questions.length - 1)
      )
    );
    setQuestionLanguages(savedDraft.languageByQuestion ?? {});
    setGradingResults(savedDraft.results ?? []);
    setScore(savedScore ?? savedDraft.score ?? null);
    setIsComplete(savedScore !== null);
    dirtyRef.current = false;
    setAnswerVersion((version) => version + 1);
  }, [nodeId, questions]);

  useEffect(() => {
    saveQuizPreferences(config);
  }, [config]);

  useEffect(() => {
    if (!nodeId || isConfiguring || !questions.length || !dirtyRef.current) return;
    const timer = window.setTimeout(() => {
      dirtyRef.current = false;
      void onSaveDraft(nodeId, {
        ...savedDraft,
        answers: { ...answersRef.current },
        currentQuestionIndex: currentIndex,
        difficultyMode: config.difficultyMode ?? "medium",
        languageByQuestion: questionLanguages,
      }).catch((error: unknown) => {
        onToast(error instanceof Error ? error.message : String(error));
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    answerVersion,
    config.difficultyMode,
    currentIndex,
    isConfiguring,
    nodeId,
    onSaveDraft,
    onToast,
    questionLanguages,
    questions.length,
    savedDraft,
  ]);

  const createDraft = (): QuizDraft => ({
    ...savedDraft,
    answers: { ...answersRef.current },
    currentQuestionIndex: currentIndex,
    languageByQuestion: questionLanguages,
    difficultyMode: config.difficultyMode ?? "medium",
    results: gradingResults,
    score: score ?? undefined,
  });

  const updateAnswer = (questionId: string, answer: QuizAnswer) => {
    answersRef.current[questionId] = answer;
    dirtyRef.current = true;
    setAnswerVersion((version) => version + 1);
  };

  const navigateToQuestion = (index: number) => {
    setCurrentIndex(index);
    dirtyRef.current = true;
    setAnswerVersion((version) => version + 1);
  };

  const navigateToItem = (index: number) => {
    const itemIndex = Math.min(Math.max(index, 0), quizItems.length - 1);
    const firstQuestionIndex = quizItems[itemIndex]?.questionIndexes[0];
    if (firstQuestionIndex !== undefined) navigateToQuestion(firstQuestionIndex);
  };

  const handleSaveDraft = async () => {
    if (!nodeId) return;
    setIsSaving(true);
    try {
      const draft = createDraft();
      await onSaveDraft(nodeId, draft);
      dirtyRef.current = false;
      onToast("Assessment draft saved.");
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!nodeId || !canSubmit || isSubmitting) return;
    try {
      const result = await onSubmit(
        nodeId,
        { ...answersRef.current },
        questionLanguages
      );
      setScore(result.score);
      setGradingResults(result.results);
      setIsComplete(true);
      dirtyRef.current = false;
      onToast(
        result.passed
          ? "Assessment passed. Lesson mastery and review schedule updated."
          : "Assessment submitted. Review the feedback and try again."
      );
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRetake = async () => {
    if (!nodeId) return;
    try {
      await onResetAttempt(nodeId);
      answersRef.current = {};
      setCurrentIndex(0);
      setGradingResults([]);
      setScore(null);
      setIsComplete(false);
      dirtyRef.current = false;
      setAnswerVersion((version) => version + 1);
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error));
    }
  };

  const canSubmit =
    questions.length > 0 &&
    questions.every((question) =>
      isAnswered(question, answersRef.current[question.id])
    );
  const subjectiveResults = useMemo(
    () => new Map(gradingResults.map((result) => [result.id, result])),
    [gradingResults]
  );
  const answeredCount = questions.reduce(
    (count, question) =>
      count + (isAnswered(question, answersRef.current[question.id]) ? 1 : 0),
    0
  );
  const activeAnswered = activeQuestion
    ? isAnswered(activeQuestion, answersRef.current[activeQuestion.id])
    : false;
  const activeItemAnsweredCount =
    activeItem?.questionIndexes.reduce(
      (count, index) =>
        count +
        (isAnswered(questions[index], answersRef.current[questions[index].id])
          ? 1
          : 0),
      0
    ) ?? 0;
  const hasQuestionNavigation = quizItems.length > 1;

  useEffect(() => {
    if (activeItem?.type !== "mcq" || !activeQuestion) return;
    document
      .getElementById(`quiz-question-${activeQuestion.id}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeItem?.type, activeQuestion?.id]);

  const handleArenaKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLElement &&
      (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) ||
        event.target.isContentEditable)
    ) {
      return;
    }
    if (
      activeQuestion?.type === "mcq" &&
      /^[1-4]$/.test(event.key) &&
      activeQuestion.options
    ) {
      updateAnswer(activeQuestion.id, Number(event.key) - 1);
    }
  };

  const handleGenerate = () => {
    if (!nodeId || config.formats.length === 0) return;
    saveQuizPreferences(config);
    void onGenerate(nodeId, config);
  };

  const selectedLanguage = (question: QuizQuestion): QuizLanguage =>
    questionLanguages[question.id] ??
    (question.language && LANGUAGES.some((item) => item.id === question.language)
      ? (question.language as QuizLanguage)
      : config.language);

  const handleLanguageChange = (
    questionId: string,
    language: QuizLanguage
  ) => {
    const nextLanguages = { ...questionLanguages, [questionId]: language };
    setQuestionLanguages(nextLanguages);
    dirtyRef.current = true;
    setAnswerVersion((version) => version + 1);
  };

  return (
    <div
      data-theme={theme}
      onKeyDown={handleArenaKeyDown}
      className="quiz-arena-shell fixed inset-0 z-40 flex flex-col bg-[var(--color-canvas)] text-[var(--color-ink)]"
    >
      <header className="quiz-arena-header relative z-10 flex min-h-16 items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-5 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
          aria-label="Exit to lesson"
        >
          <ArrowLeft className="h-4 w-4" />
          Exit to Lesson
        </button>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--color-accent-button)] text-[var(--color-accent-foreground)] shadow-sm">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
            Noesis · mastery checkpoint
          </p>
          <h1 className="truncate text-sm font-bold text-[var(--color-ink)]">
            {lessonTitle}
          </h1>
        </div>
        {!isLoading && !isConfiguring && questions.length > 0 && (
          <div className="hidden shrink-0 items-center gap-1 xl:flex">
            <button
              type="button"
              onClick={() => setIsOverviewOpen((open) => !open)}
              aria-controls="quiz-item-overview"
              aria-expanded={isOverviewOpen}
              aria-label={`${isOverviewOpen ? "Hide" : "Show"} item overview`}
              title={`${isOverviewOpen ? "Hide" : "Show"} item overview`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 text-[11px] font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]"
            >
              {isOverviewOpen ? (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              )}
              Overview
            </button>
            {hasQuestionNavigation && (
              <button
                type="button"
                onClick={() => setIsQuestionNavOpen((open) => !open)}
                aria-controls="quiz-question-navigation"
                aria-expanded={isQuestionNavOpen}
                aria-label={`${isQuestionNavOpen ? "Hide" : "Show"} item navigation`}
                title={`${isQuestionNavOpen ? "Hide" : "Show"} item navigation`}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 text-[11px] font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]"
              >
                {isQuestionNavOpen ? (
                  <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                )}
                Items
              </button>
            )}
          </div>
        )}
        {!isConfiguring && questions.length > 0 && (
          <button
            onClick={() => nodeId && onConfigure(nodeId)}
            disabled={isLoading || isSubmitting}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold transition hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Regenerate Quiz
          </button>
        )}
      </header>

      {isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
          <p className="text-sm font-semibold">Preparing your assessment…</p>
          <p className="text-xs text-[var(--color-muted)]">
            {generationProgress && generationProgress.total > 1
              ? `Generating question batch ${Math.min(
                  generationProgress.completed + 1,
                  generationProgress.total
                )} of ${generationProgress.total}…`
              : "This may take a moment while the lesson-grounded questions are generated."}
          </p>
          {generationProgress && generationProgress.total > 1 && (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={generationProgress.total}
              aria-valuenow={generationProgress.completed}
              className="h-1 w-48 overflow-hidden rounded-full bg-[var(--color-border)]"
            >
              <div
                className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
                style={{
                  width: `${(generationProgress.completed / generationProgress.total) * 100}%`,
                }}
              />
            </div>
          )}
          {canCancelGeneration && (
            <button
              type="button"
              onClick={onCancelGeneration}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop generation
            </button>
          )}
        </div>
      ) : isConfiguring ? (
        <div className="flex flex-1 items-start justify-center overflow-y-auto p-5 md:items-center md:p-8">
          <section className="quiz-config-card w-full max-w-3xl rounded-3xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 shadow-xl md:p-8">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--color-accent-button)] text-[var(--color-accent-foreground)] shadow-sm">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-muted)]">
                  Assessment studio
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">
                  Build your assessment
                </h2>
                <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">
                  Choose how you want to practice. Your quiz will stay grounded
                  in this lesson.
                </p>
              </div>
              {questions.length > 0 && (
                <button
                  onClick={onCancelConfiguration}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--color-hover)]"
                >
                  Back to quiz
                </button>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 text-xs"
              >
                <p className="break-words">{error}</p>
                <button
                  onClick={handleGenerate}
                  disabled={config.formats.length === 0}
                  className="shrink-0 rounded-lg bg-[var(--color-panel)] px-3 py-2 font-semibold hover:bg-[var(--color-hover)] disabled:opacity-50"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="mt-7">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[var(--color-ink)]">
                    Choose question styles
                  </h3>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">
                    Select one or more ways to check your understanding.
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1 text-[11px] font-semibold text-[var(--color-ink)]">
                  {config.formats.length} selected
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {FORMATS.map((format) => {
                  const selected = config.formats.includes(format.id);
                  return (
                    <button
                      key={format.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setConfig((current) => {
                          const formats = selected
                            ? current.formats.filter((item) => item !== format.id)
                            : [...current.formats, format.id];
                          if (formats.length === 0) return current;
                          return { ...current, formats };
                        })
                      }
                      className={`min-h-36 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                        selected
                          ? "border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] shadow-sm"
                          : "border-[var(--color-border)] bg-[var(--color-panel)] hover:border-[var(--color-border-strong)]"
                      }`}
                    >
                      <span className="mb-4 flex items-center justify-between">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-accent-button)] text-[var(--color-accent-foreground)]">
                          {format.id === "mcq" ? (
                            <Check className="h-4 w-4" />
                          ) : format.id === "coding" ? (
                            <Code2 className="h-4 w-4" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                        </span>
                        <span className="text-[10px] font-semibold text-[var(--color-ink)]">
                          {selected ? "Selected" : "Choose"}
                        </span>
                      </span>
                      <span className="block text-sm font-bold text-[var(--color-ink)]">
                        {format.label}
                      </span>
                      <span className="mt-1.5 block text-xs leading-5 text-[var(--color-muted)]">
                        {format.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              {[
                ["Styles", String(config.formats.length)],
                ["Questions", String(config.count)],
                [
                  "Challenge",
                  (config.difficultyMode ?? "medium").replace(/^\w/, (letter) =>
                    letter.toUpperCase()
                  ),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2.5"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
                    {label}
                  </p>
                  <p className="mt-0.5 truncate text-xs font-bold text-[var(--color-ink)]">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <details className="disclosure-chevron quiz-options-disclosure mt-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-4">
              <summary className="cursor-pointer py-3 text-xs font-semibold text-[var(--color-ink)]">
                Fine-tune your assessment
              </summary>
              <div className="grid gap-5 border-t border-[var(--color-border)] py-4 md:grid-cols-2">
                <label className="block text-xs font-semibold">
                  Question count
                  <div className="mt-2 flex flex-wrap gap-2">
                    {([3, 5, 8, 10, 12] as const).map((count) => (
                      <button
                        key={count}
                        type="button"
                        aria-pressed={config.count === count}
                        onClick={() => setConfig({ ...config, count })}
                        className={`rounded-lg border px-4 py-2 text-xs font-semibold ${
                          config.count === count
                            ? "border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]"
                            : "border-[var(--color-border)] hover:bg-[var(--color-hover)]"
                        }`}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </label>
                {config.formats.includes("coding") && (
                  <label className="block text-xs font-semibold">
                    Coding language
                    <select
                      value={config.language}
                      onChange={(event) =>
                        setConfig({
                          ...config,
                          language: event.target.value as QuizLanguage,
                        })
                      }
                      className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2.5 text-xs"
                    >
                      {LANGUAGES.map((language) => (
                        <option key={language.id} value={language.id}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block text-xs font-semibold">
                  Difficulty
                  <select
                    value={config.difficultyMode ?? "medium"}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        difficultyMode: event.target.value as NonNullable<
                          QuizGenerationConfig["difficultyMode"]
                        >,
                      })
                    }
                    className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2.5 text-xs"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                    <option value="progressive">
                      Hybrid: Progressive (Easy → Hard)
                    </option>
                    <option value="balanced">Hybrid: Balanced Mix</option>
                  </select>
                </label>
              </div>
            </details>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-5">
              <p className="text-[11px] text-[var(--color-muted)]">
                Preferred formats and language are saved on this device.
              </p>
              <button
                onClick={handleGenerate}
                disabled={!nodeId || config.formats.length === 0}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-accent-button)] px-5 py-2.5 text-xs font-bold text-[var(--color-accent-foreground)] shadow-sm transition hover:-translate-y-0.5 hover:brightness-95 hover:shadow-md disabled:translate-y-0 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                Generate Assessment
              </button>
            </div>
          </section>
        </div>
      ) : questions.length === 0 ? (
        <div className="m-auto max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 text-center">
          <p className="text-sm font-semibold">No assessment questions are available.</p>
          {error && <p role="alert" className="mt-2 text-xs text-[var(--color-warning)]">{error}</p>}
          <button
            onClick={() => nodeId && onConfigure(nodeId)}
            className="mt-4 min-h-10 rounded-xl bg-[var(--color-accent-button)] px-4 py-2 text-xs font-bold text-[var(--color-accent-foreground)] shadow-sm"
          >
            Configure Quiz
          </button>
        </div>
      ) : (
        <>
          {error && (
            <div role="alert" className="mx-5 mt-3 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs">
              {error}
            </div>
          )}
          <main className="flex min-h-0 flex-1 overflow-hidden">
            <aside
              id="quiz-item-overview"
              aria-label="Assessment item overview"
              aria-hidden={!isOverviewOpen}
              className={
                isOverviewOpen
                  ? "hidden w-52 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-4 xl:flex"
                  : "hidden"
              }
            >
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                  Item {currentItemIndex + 1}
                </p>
                <h2 className="mt-2 text-base font-bold text-[var(--color-ink)]">
                  {activeItem?.type === "mcq"
                    ? "Multiple choice"
                    : activeItem?.type === "coding"
                      ? "Coding challenge"
                      : "Written response"}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  {activeItem?.questionIndexes.length ?? 0} question
                  {activeItem?.questionIndexes.length === 1 ? "" : "s"}
                </p>
                <div
                  className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-panel-subtle)]"
                  role="progressbar"
                  aria-label="Current item completion"
                  aria-valuemin={0}
                  aria-valuemax={activeItem?.questionIndexes.length ?? 0}
                  aria-valuenow={activeItemAnsweredCount}
                >
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
                    style={{
                      width: `${
                        activeItem?.questionIndexes.length
                          ? (activeItemAnsweredCount /
                              activeItem.questionIndexes.length) *
                            100
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
              <p className="mt-4 border-t border-[var(--color-border)] pt-3 text-[10px] leading-4 text-[var(--color-muted)]">
                {hasQuestionNavigation
                  ? "Use item navigation to jump between sections."
                  : "Your response is saved as you work."}
              </p>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              {activeItem?.type === "mcq" ? (
                <section className="min-w-0 flex-1 overflow-y-auto bg-[var(--color-canvas)] p-4 sm:p-6 lg:p-8">
                  <div className="mx-auto max-w-4xl">
                    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                          Multiple-choice set
                        </p>
                        <h2 className="mt-1 text-xl font-bold text-[var(--color-ink)]">
                          Select an answer for each question
                        </h2>
                      </div>
                      <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)]">
                        {activeItemAnsweredCount} /{" "}
                        {activeItem.questionIndexes.length} answered
                      </span>
                    </div>
                    <div className="space-y-5">
                      {activeItem.questionIndexes.map(
                        (questionIndex, itemQuestionIndex) => {
                          const question = questions[questionIndex];
                          const answered = isAnswered(
                            question,
                            answersRef.current[question.id]
                          );

                          return (
                            <article
                              id={`quiz-question-${question.id}`}
                              key={question.id}
                              className="scroll-mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-sm sm:p-6"
                            >
                              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-accent-button)] text-xs font-bold text-[var(--color-accent-foreground)]">
                                    {itemQuestionIndex + 1}
                                  </span>
                                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
                                    Question {itemQuestionIndex + 1}
                                  </span>
                                  <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-2 py-1 text-[9px] font-semibold text-[var(--color-muted)]">
                                    {(question.difficulty ?? "medium").toUpperCase()}
                                  </span>
                                </div>
                                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-muted)]">
                                  <span
                                    aria-hidden="true"
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      answered
                                        ? "bg-[var(--color-success)]"
                                        : "bg-[var(--color-border-strong)]"
                                    }`}
                                  />
                                  {answered ? "Answered" : "Not answered"}
                                </span>
                              </div>
                              <RichContent className="prose prose-sm max-w-none text-[var(--color-ink)]">
                                {question.prompt}
                              </RichContent>
                              <div className="mt-4 space-y-2.5">
                                {(question.options ?? []).map(
                                  (option, optionIndex) => {
                                    const selected =
                                      answersRef.current[question.id] ===
                                      optionIndex;
                                    const isCorrect =
                                      isComplete &&
                                      question.answerIndex === optionIndex;
                                    return (
                                      <button
                                        key={`${question.id}-${optionIndex}`}
                                        type="button"
                                        aria-pressed={selected}
                                        disabled={isComplete || isSubmitting}
                                        onClick={() => {
                                          setCurrentIndex(questionIndex);
                                          updateAnswer(
                                            question.id,
                                            optionIndex
                                          );
                                        }}
                                        className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left text-sm transition sm:p-4 ${
                                          isCorrect
                                            ? "border-[var(--color-success)] bg-[var(--color-success)]/10"
                                            : selected
                                              ? "border-[var(--color-border-strong)] bg-[var(--color-accent-soft)] shadow-sm"
                                              : "border-[var(--color-border)] bg-[var(--color-panel)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-panel-subtle)]"
                                        }`}
                                      >
                                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-current text-[10px] font-bold">
                                          {optionIndex + 1}
                                        </span>
                                        <span className="min-w-0 flex-1 pt-0.5">
                                          <RichContent inline>{option}</RichContent>
                                        </span>
                                        {isCorrect && (
                                          <Check className="mt-1 h-4 w-4 shrink-0 text-[var(--color-success)]" />
                                        )}
                                      </button>
                                    );
                                  }
                                )}
                              </div>
                              {isComplete && question.explanation && (
                                <RichContent className="prose prose-sm mt-4 max-w-none rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-4 text-[var(--color-muted)]">
                                  {question.explanation}
                                </RichContent>
                              )}
                            </article>
                          );
                        }
                      )}
                    </div>
                  </div>
                </section>
              ) : (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
            <section className="min-h-0 overflow-y-auto border-b border-[var(--color-border)] bg-[var(--color-panel)] p-5 select-text lg:w-[42%] lg:border-b-0 lg:border-r lg:p-8">
              {activeQuestion && (
                <div className="mx-auto max-w-2xl">
                  <div className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink)]">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-accent-button)] text-[var(--color-accent-foreground)]">
                      {activeQuestion.type === "coding" ? (
                        <Code2 className="h-4 w-4" />
                      ) : activeQuestion.type === "mcq" ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                    </span>
                    <span>{activeQuestion.type.replace("_", " ")}</span>
                    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-2 py-0.5 text-[9px] text-[var(--color-muted)]">
                      {(activeQuestion.difficulty ?? "medium").toUpperCase()}
                    </span>
                  </div>
                  <RichContent className="prose prose-sm max-w-none text-[var(--color-ink)]">
                    {activeQuestion.prompt}
                  </RichContent>
                  {activeQuestion.testCases && (
                    <div className="mt-7 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-4">
                      <h3 className="text-xs font-bold">Sample cases</h3>
                      <ol className="mt-2 list-inside list-decimal space-y-2 text-xs leading-5 text-[var(--color-muted)]">
                        {activeQuestion.testCases.map((testCase, index) => (
                          <li key={`${activeQuestion.id}-${index}`}>
                            <RichContent inline>{testCase}</RichContent>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {activeQuestion.rubric && (
                    <div className="mt-5 rounded-xl border border-[var(--color-border)] p-4">
                      <h3 className="text-xs font-bold">What we’re looking for</h3>
                      <RichContent className="prose prose-xs mt-2 max-w-none text-[var(--color-muted)]">
                        {activeQuestion.rubric}
                      </RichContent>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="flex min-h-0 flex-1 flex-col bg-[var(--color-canvas)] p-4 lg:w-[58%] lg:p-7">
              {activeQuestion && (
                <div className="mx-auto mb-4 w-full max-w-4xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[var(--color-ink)]">
                        Question {currentIndex + 1} of {questions.length}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                        Continue with this question to complete the item.
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-ink)]">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${
                          activeAnswered
                            ? "bg-[var(--color-success)]"
                            : "bg-[var(--color-border-strong)]"
                        }`}
                      />
                      {activeAnswered ? "Answered" : "In progress"}
                    </span>
                  </div>
                </div>
              )}
              {activeQuestion && (
                <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
                  {activeQuestion.type === "open_ended" ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                      <label className="mb-2 text-xs font-semibold">
                        Your response
                      </label>
                      <textarea
                        value={
                          (answersRef.current[activeQuestion.id] as string) ?? ""
                        }
                        disabled={isComplete || isSubmitting}
                        onChange={(event) =>
                          updateAnswer(activeQuestion.id, event.target.value)
                        }
                        placeholder="Explain your reasoning clearly…"
                        className="min-h-60 flex-1 resize-none rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 text-sm leading-6 outline-none focus:border-[var(--color-accent)]"
                      />
                      <p className="mt-2 text-right text-[10px] text-[var(--color-muted)]">
                        {(answersRef.current[activeQuestion.id] as string ?? "").trim().split(/\s+/).filter(Boolean).length} words · {(answersRef.current[activeQuestion.id] as string ?? "").length} characters
                      </p>
                      {isComplete && subjectiveResults.get(activeQuestion.id) && (
                        <GradingFeedback result={subjectiveResults.get(activeQuestion.id)!} />
                      )}
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)]">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
                        <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
                          Language
                          <select
                            value={selectedLanguage(activeQuestion)}
                            disabled={isComplete || isSubmitting}
                            onChange={(event) =>
                              handleLanguageChange(
                                activeQuestion.id,
                                event.target.value as QuizLanguage
                              )
                            }
                            className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-xs normal-case tracking-normal text-[var(--color-ink)]"
                          >
                            {LANGUAGES.filter((language) => language.id !== "auto").map((language) => (
                              <option key={language.id} value={language.id}>{language.label}</option>
                            ))}
                          </select>
                        </label>
                        <button
                          disabled={isComplete || isSubmitting}
                          onClick={() =>
                            updateAnswer(
                              activeQuestion.id,
                              activeQuestion.starterCode ?? ""
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold text-[var(--color-muted)] hover:bg-[var(--color-hover)] disabled:opacity-50"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reset Starter Code
                        </button>
                      </div>
                      <div className="min-h-[280px] flex-1 overflow-hidden">
                        <Suspense
                          fallback={
                            <div className="p-5 text-xs text-[var(--color-muted)]">
                              Loading editor…
                            </div>
                          }
                        >
                          <CodeEditor
                            language={selectedLanguage(activeQuestion)}
                            theme={theme}
                            value={
                              (answersRef.current[activeQuestion.id] as string) ??
                              activeQuestion.starterCode ??
                              ""
                            }
                            readOnly={isComplete || isSubmitting}
                            onChange={(value) =>
                              updateAnswer(activeQuestion.id, value)
                            }
                          />
                        </Suspense>
                      </div>
                      {isComplete && subjectiveResults.get(activeQuestion.id) && (
                        <GradingFeedback result={subjectiveResults.get(activeQuestion.id)!} />
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
                </div>
              )}
            </div>

            {hasQuestionNavigation && (
              <aside
                id="quiz-question-navigation"
                aria-label="Assessment item navigation"
                aria-hidden={!isQuestionNavOpen}
                className={
                  isQuestionNavOpen
                    ? "hidden w-52 shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-4 xl:flex"
                    : "hidden"
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink)]">
                      Item navigation
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-[var(--color-muted)]">
                      Jump between assessment items.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsQuestionNavOpen(false)}
                    aria-label="Hide item navigation"
                    title="Hide item navigation"
                    className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)]"
                  >
                    <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                  <nav
                    aria-label="Assessment items"
                    className="mt-4 grid grid-cols-4 content-start gap-2"
                  >
                    {quizItems.map((item, itemIndex) => {
                      const answeredCountForItem = item.questionIndexes.reduce(
                        (count, questionIndex) =>
                          count +
                          (isAnswered(
                            questions[questionIndex],
                            answersRef.current[questions[questionIndex].id]
                          )
                            ? 1
                            : 0),
                        0
                      );
                      const isCompleteItem =
                        answeredCountForItem === item.questionIndexes.length;
                      const isCurrent = currentItemIndex === itemIndex;
                        return (
                          <button
                            key={`${item.type}-${item.questionIndexes.join("-")}`}
                            type="button"
                            onClick={() => navigateToItem(itemIndex)}
                            aria-current={isCurrent ? "step" : undefined}
                            aria-label={`Item ${itemIndex + 1}: ${
                              item.type === "mcq"
                                ? "multiple choice"
                                : item.type === "coding"
                                  ? "coding"
                                  : "written response"
                            }, ${
                              isCompleteItem ? "complete" : "incomplete"
                            }`}
                            className={`relative grid h-10 w-10 place-items-center rounded-lg border text-xs font-bold transition ${
                              isCurrent
                                ? "border-[var(--color-accent-button)] bg-[var(--color-accent-button)] text-[var(--color-accent-foreground)] shadow-sm"
                                : isCompleteItem
                                  ? "border-[var(--color-success)]/50 bg-[var(--color-success)]/10 text-[var(--color-ink)] hover:bg-[var(--color-success)]/20"
                                  : "border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
                            }`}
                          >
                            {itemIndex + 1}
                            <span
                              aria-hidden="true"
                              className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                                isCompleteItem
                                  ? "bg-[var(--color-success)]"
                                  : "bg-[var(--color-border-strong)]"
                              }`}
                            />
                          </button>
                        );
                    })}
                  </nav>
              </aside>
            )}
          </main>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-5 py-3">
            <div className="min-w-0 text-xs text-[var(--color-muted)]">
              {isComplete && score !== null ? (
                <span
                  className={`font-semibold ${
                    score >= passThreshold / 100
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-warning)]"
                  }`}
                >
                  Score: {Math.round(score * 100)}% ·{" "}
                  {score >= passThreshold / 100
                    ? "Mastery achieved"
                    : `Pass threshold ${passThreshold}%`}
                  {" · "}
                  {(["easy", "medium", "hard"] as const)
                    .map(
                      (difficulty) =>
                        `${difficulty}: ${questions.filter((question) => question.difficulty === difficulty).length}`
                    )
                    .join(" / ")}
                </span>
              ) : (
                <>Answered {answeredCount} of {questions.length}</>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                disabled={currentItemIndex <= 0}
                onClick={() => navigateToItem(currentItemIndex - 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--color-hover)] disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous item
              </button>
              <span className="min-w-12 text-center text-xs font-semibold text-[var(--color-muted)]">
                {currentItemIndex + 1} / {quizItems.length}
              </span>
              <button
                disabled={currentItemIndex >= quizItems.length - 1}
                onClick={() => navigateToItem(currentItemIndex + 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--color-hover)] disabled:opacity-40"
              >
                Next item
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                disabled={isSaving || isSubmitting}
                onClick={() => void handleSaveDraft()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-semibold hover:bg-[var(--color-hover)] disabled:opacity-40"
              >
                <Save className="h-3.5 w-3.5" />
                {isSaving ? "Saving…" : "Save Draft"}
              </button>
              {!isComplete && (
                <button
                  disabled={!canSubmit || isSubmitting}
                  onClick={() => void handleSubmit()}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[var(--color-accent-button)] px-4 py-2 text-xs font-bold text-[var(--color-accent-foreground)] shadow-sm transition hover:-translate-y-0.5 hover:brightness-95 disabled:translate-y-0 disabled:opacity-40"
                >
                  {isSubmitting ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Submit Assessment
                </button>
              )}
              {isComplete &&
                score !== null &&
                score < passThreshold / 100 && (
                  <button
                    onClick={() => void handleRetake()}
                    className="rounded-xl bg-[var(--color-accent-button)] px-4 py-2 text-xs font-bold text-[var(--color-accent-foreground)] shadow-sm transition hover:brightness-95"
                  >
                    Try Again
                  </button>
                )}
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

function GradingFeedback({ result }: { result: QuizGradingResult }) {
  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-panel-subtle)] p-3 text-xs">
      <p className="font-semibold">
        Score: {Math.round(result.score * 100)}% ·{" "}
        {result.passed ? "Meets rubric" : "Needs revision"}
      </p>
      <RichContent className="prose prose-xs mt-1 max-w-none text-[var(--color-muted)]">
        {result.feedback}
      </RichContent>
      {result.optimalSolution && (
        <details className="disclosure-chevron mt-2">
          <summary className="cursor-pointer font-semibold">Reference solution</summary>
          <RichContent className="prose prose-xs mt-1 max-w-none text-[var(--color-muted)]">
            {result.optimalSolution}
          </RichContent>
        </details>
      )}
    </div>
  );
}
