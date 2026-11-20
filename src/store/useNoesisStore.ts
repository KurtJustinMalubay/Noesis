import { create } from "zustand";
import type {
  GraphEdge,
  GraphNode,
  QuizAnswer,
  QuizDraft,
  QuizGenerationConfig,
  QuizGradingResult,
  QuizLanguage,
  QuizQuestion,
  Workspace,
} from "../types/domain";
import {
  deleteWorkspace,
  listWorkspaces,
} from "../db/repositories/workspaceRepo";
import {
  getWorkspaceGraph,
  updateNodesStatusBatch,
} from "../db/repositories/graphRepo";
import {
  getDueFlashcards,
  getNodeFlashcards,
  updateFlashcardSchedule,
  updateFlashcardSchedules,
  type DueFlashcard,
} from "../db/repositories/flashcardRepo";
import {
  deleteDocument,
  listDocuments,
  type StoredDocument,
} from "../db/repositories/documentRepo";
import {
  generateWorkspaceCurriculum,
  hydrateNodeContent,
} from "../ai/curriculumService";
import {
  generateNodeQuiz,
  gradeSubjectiveBatch,
  type SubjectiveQuizItem,
} from "../ai/quizService";
import {
  getNodeQuiz,
  hasNodeQuiz,
  resetNodeQuizAttempt,
  saveNodeQuiz,
  saveNodeQuizDraft,
  saveNodeQuizScore,
} from "../db/repositories/quizRepo";
import { computeMasteryCascade } from "../engine/masteryCascade";
import { scheduleNextReview, type ReviewGrade } from "../engine/sm2Scheduler";
import {
  hasConfiguredApiKey,
  getReviewsCompletedToday,
  loadUserPreferences,
  recordCompletedReview,
  saveUserPreferences,
  type UserPreferences,
} from "../ai/keyStore";
import type { CurriculumProgress } from "../ai/curriculumService";

export type ActiveModal =
  | "none"
  | "settings"
  | "vault"
  | "review"
  | "diagnostic"
  | "completion"
  | "new_workspace";

interface NoesisState {
  // Core entities
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  nodes: GraphNode[];
  nodeIndex: Map<string, number>;
  edges: GraphEdge[];
  selectedNodeId: string | null;
  dueCards: DueFlashcard[];
  documents: StoredDocument[];

  // UI & navigation state
  activeModal: ActiveModal;
  isTutorOpen: boolean;
  isGeneratingCurriculum: boolean;
  curriculumAbortController: AbortController | null;
  curriculumProgress: CurriculumProgress | null;
  hydratingNodeIds: Set<string>;
  hydrationErrors: Map<string, string>;
  diagnosticQuestions: QuizQuestion[];
  diagnosticConfig: QuizGenerationConfig | null;
  diagnosticDraft: QuizDraft;
  diagnosticScore: number | null;
  isLoadingDiagnostic: boolean;
  isSubmittingDiagnostic: boolean;
  isConfiguringDiagnostic: boolean;
  diagnosticError: string | null;
  quizNodeIds: Set<string>;
  checkedQuizNodeIds: Set<string>;
  toastMessage: string | null;
  preferences: UserPreferences;

  // Actions
  initAppData: () => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  generateNewCurriculum: (topicPrompt: string) => Promise<void>;
  cancelCurriculumGeneration: () => void;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  selectNode: (nodeId: string | null) => Promise<void>;
  markNodeMastered: (nodeId: string, score?: number) => Promise<void>;
  openDiagnosticForNode: (nodeId: string) => Promise<void>;
  configureDiagnosticForNode: (nodeId: string) => void;
  cancelDiagnosticConfiguration: () => void;
  generateConfiguredDiagnostic: (
    nodeId: string,
    config: QuizGenerationConfig
  ) => Promise<void>;
  saveDiagnosticDraft: (nodeId: string, draft: QuizDraft) => Promise<void>;
  resetDiagnosticAttempt: (nodeId: string) => Promise<void>;
  submitDiagnostic: (
    nodeId: string,
    answers: Record<string, QuizAnswer>,
    languages?: Record<string, QuizLanguage>
  ) => Promise<{ score: number; passed: boolean; results: QuizGradingResult[] }>;
  refreshNodeQuizAvailability: (nodeId: string) => Promise<void>;
  clearQuizAvailability: () => void;
  gradeDueCard: (card: DueFlashcard, grade: ReviewGrade) => Promise<void>;
  refreshDocuments: () => Promise<void>;
  removeDocument: (docId: string) => Promise<void>;
  setActiveModal: (modal: ActiveModal) => void;
  setTutorOpen: (open: boolean) => void;
  setPreferences: (preferences: UserPreferences) => Promise<void>;
  showToast: (msg: string | null) => void;
}

export const useNoesisStore = create<NoesisState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  nodes: [],
  nodeIndex: new Map(),
  edges: [],
  selectedNodeId: null,
  dueCards: [],
  documents: [],

  activeModal: "none",
  isTutorOpen: false,
  isGeneratingCurriculum: false,
  curriculumAbortController: null,
  curriculumProgress: null,
  hydratingNodeIds: new Set(),
  hydrationErrors: new Map(),
  diagnosticQuestions: [],
  diagnosticConfig: null,
  diagnosticDraft: { answers: {}, currentQuestionIndex: 0 },
  diagnosticScore: null,
  isLoadingDiagnostic: false,
  isSubmittingDiagnostic: false,
  isConfiguringDiagnostic: false,
  diagnosticError: null,
  quizNodeIds: new Set(),
  checkedQuizNodeIds: new Set(),
  toastMessage: null,
  preferences: loadUserPreferences(),

  initAppData: async () => {
    const [workspaces, documents] = await Promise.all([
      listWorkspaces(),
      listDocuments(),
    ]);

    set({ workspaces, documents });

    if (workspaces.length > 0) {
      await get().selectWorkspace(workspaces[0].id);
    } else if (!hasConfiguredApiKey()) {
      set({ activeModal: "settings" });
    } else {
      set({ activeModal: "new_workspace" });
    }
  },

  selectWorkspace: async (workspaceId: string) => {
    const [{ nodes, edges }, dueCards, documents] = await Promise.all([
      getWorkspaceGraph(workspaceId),
      getDueFlashcards(workspaceId),
      listDocuments(workspaceId),
    ]);

    const preferences = get().preferences;
    const remainingReviews =
      preferences.dailyReviewLimit === 0
        ? dueCards.length
        : Math.max(
            0,
            preferences.dailyReviewLimit - getReviewsCompletedToday()
          );
    set({
      activeWorkspaceId: workspaceId,
      nodes,
      nodeIndex: new Map(nodes.map((node, index) => [node.id, index])),
      edges,
      dueCards: dueCards.slice(0, remainingReviews),
      documents,
      selectedNodeId: null,
      quizNodeIds: new Set(),
      checkedQuizNodeIds: new Set(),
    });
  },

  generateNewCurriculum: async (topicPrompt: string) => {
    if (get().isGeneratingCurriculum) return;
    const controller = new AbortController();
    set({
      isGeneratingCurriculum: true,
      curriculumProgress: { phase: "Preparing curriculum…", nodeTitles: [] },
      curriculumAbortController: controller,
    });
    try {
      const { workspace, nodes, edges } = await generateWorkspaceCurriculum(
        topicPrompt,
        (curriculumProgress) => set({ curriculumProgress }),
        controller.signal
      );
      const workspaces = [workspace, ...get().workspaces];
      set({
        workspaces,
        activeWorkspaceId: workspace.id,
        nodes,
        nodeIndex: new Map(nodes.map((node, index) => [node.id, index])),
        edges,
        selectedNodeId: null,
        dueCards: [],
        activeModal: "none",
        curriculumProgress: null,
      });
      get().showToast(`Generated ${nodes.length}-node DAG for "${workspace.title}"`);
    } catch (error) {
      if (controller.signal.aborted) {
        get().showToast("Curriculum generation stopped.");
        return;
      }
      throw error;
    } finally {
      set({
        isGeneratingCurriculum: false,
        curriculumProgress: null,
        curriculumAbortController: null,
      });
    }
  },

  cancelCurriculumGeneration: () =>
    get().curriculumAbortController?.abort(),

  removeWorkspace: async (workspaceId: string) => {
    await deleteWorkspace(workspaceId);
    const remaining = get().workspaces.filter((w) => w.id !== workspaceId);
    set({ workspaces: remaining });

    if (get().activeWorkspaceId === workspaceId) {
      if (remaining.length > 0) {
        await get().selectWorkspace(remaining[0].id);
      } else {
        const documents = await listDocuments();
        set({
          activeWorkspaceId: null,
          nodes: [],
          nodeIndex: new Map(),
          edges: [],
          selectedNodeId: null,
          dueCards: [],
          documents,
        });
      }
    }
  },

  selectNode: async (nodeId: string | null) => {
    if (!nodeId) {
      set({ selectedNodeId: null });
      return;
    }

    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (node.status === "locked") {
      get().showToast("Complete prerequisite nodes first to unlock this concept.");
      return;
    }

    set({ selectedNodeId: nodeId });
    void get().refreshNodeQuizAvailability(nodeId);

    // Auto-hydrate lesson + Mermaid diagram + flashcards on first open
    if (
      node.is_hydrated === 0 &&
      !get().hydratingNodeIds.has(node.id)
    ) {
      const ws = get().workspaces.find((w) => w.id === node.workspace_id);
      const hydratingNodeIds = new Set(get().hydratingNodeIds);
      hydratingNodeIds.add(node.id);
      const hydrationErrors = new Map(get().hydrationErrors);
      hydrationErrors.delete(node.id);
      set({ hydratingNodeIds, hydrationErrors });
      try {
        const hydrated = await hydrateNodeContent(
          node,
          ws?.title ?? "Noesis Course"
        );
        const updatedNodes = get().nodes.map((n) =>
          n.id === node.id
            ? {
                ...n,
                is_hydrated: 1,
                lesson_markdown: hydrated.lessonMarkdown,
                mermaid_diagram: hydrated.mermaidDiagram,
                source_citations: JSON.stringify(hydrated.citations),
                status: n.status === "unlocked" ? ("in_progress" as const) : n.status,
              }
            : n
        );
        const dueCards = node.workspace_id
          ? await getDueFlashcards(node.workspace_id)
          : get().dueCards;
        set({ nodes: updatedNodes, dueCards });
      } catch (err) {
        const hydrationErrors = new Map(get().hydrationErrors);
        hydrationErrors.set(
          node.id,
          err instanceof Error ? err.message : "Failed to generate node lesson."
        );
        set({ hydrationErrors });
        get().showToast(
          err instanceof Error ? err.message : "Failed to generate node lesson."
        );
      } finally {
        const remainingHydrations = new Set(get().hydratingNodeIds);
        remainingHydrations.delete(node.id);
        set({ hydratingNodeIds: remainingHydrations });
      }
    }
  },

  markNodeMastered: async (nodeId: string, score = 1.0) => {
    const { nodes, nodeIndex, edges } = get();
    const { updatedNodes, patches, newlyUnlockedIds } = computeMasteryCascade(
      nodes,
      edges,
      nodeId,
      score,
      nodeIndex
    );

    if (patches.length > 0) {
      await updateNodesStatusBatch(patches);
      set({ nodes: updatedNodes });
    }

    if (newlyUnlockedIds.length > 0) {
      get().showToast(
        `Mastered! Unlocked ${newlyUnlockedIds.length} downstream concept${
          newlyUnlockedIds.length > 1 ? "s" : ""
        }.`
      );
    } else {
      get().showToast("Concept marked as mastered!");
    }
  },

  openDiagnosticForNode: async (nodeId: string) => {
    set({
      activeModal: "diagnostic",
      isLoadingDiagnostic: true,
      diagnosticError: null,
      isConfiguringDiagnostic: false,
    });

    try {
      const record = await getNodeQuiz(nodeId);
      const checkedQuizNodeIds = new Set(get().checkedQuizNodeIds);
      checkedQuizNodeIds.add(nodeId);
      const quizNodeIds = new Set(get().quizNodeIds);
      if (record) quizNodeIds.add(nodeId);
      else quizNodeIds.delete(nodeId);
      set({
        diagnosticQuestions: record?.questions ?? [],
        diagnosticConfig: record?.config ?? null,
        diagnosticDraft:
          record?.draft ?? { answers: {}, currentQuestionIndex: 0 },
        diagnosticScore: record?.score ?? null,
        quizNodeIds,
        checkedQuizNodeIds,
        isConfiguringDiagnostic: !record,
      });
    } catch (err) {
      set({
        diagnosticError:
          err instanceof Error ? err.message : String(err),
        diagnosticQuestions: [],
        isConfiguringDiagnostic: true,
      });
    } finally {
      set({ isLoadingDiagnostic: false });
    }
  },

  configureDiagnosticForNode: () =>
    set({ isConfiguringDiagnostic: true, diagnosticError: null }),

  cancelDiagnosticConfiguration: () =>
    set({ isConfiguringDiagnostic: false, diagnosticError: null }),

  generateConfiguredDiagnostic: async (
    nodeId: string,
    config: QuizGenerationConfig
  ) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node || get().isLoadingDiagnostic) return;
    set({
      isLoadingDiagnostic: true,
      isConfiguringDiagnostic: false,
      diagnosticError: null,
    });
    try {
      const questions = await generateNodeQuiz(node, config);
      await saveNodeQuiz(nodeId, questions, config);
      const quizNodeIds = new Set(get().quizNodeIds);
      quizNodeIds.add(nodeId);
      const checkedQuizNodeIds = new Set(get().checkedQuizNodeIds);
      checkedQuizNodeIds.add(nodeId);
      set({
        diagnosticQuestions: questions,
        diagnosticConfig: config,
        diagnosticDraft: { answers: {}, currentQuestionIndex: 0 },
        diagnosticScore: null,
        quizNodeIds,
        checkedQuizNodeIds,
        isConfiguringDiagnostic: false,
      });
    } catch (err) {
      set({
        diagnosticError:
          err instanceof Error ? err.message : String(err),
        isConfiguringDiagnostic: true,
      });
    } finally {
      set({ isLoadingDiagnostic: false });
    }
  },

  saveDiagnosticDraft: async (nodeId, draft) => {
    await saveNodeQuizDraft(nodeId, draft);
    set({ diagnosticDraft: draft });
  },

  resetDiagnosticAttempt: async (nodeId) => {
    await resetNodeQuizAttempt(nodeId);
    set({
      diagnosticDraft: { answers: {}, currentQuestionIndex: 0 },
      diagnosticScore: null,
    });
  },

  submitDiagnostic: async (nodeId, answers, languages) => {
    const { diagnosticQuestions: questions, preferences } = get();
    if (questions.length === 0) {
      throw new Error("This assessment has no questions to submit.");
    }

    set({ isSubmittingDiagnostic: true, diagnosticError: null });
    try {
      const subjectiveItems: SubjectiveQuizItem[] = [];
      let totalScore = 0;
      for (const question of questions) {
        const answer = answers[question.id];
        if (question.type === "mcq") {
          totalScore += answer === question.answerIndex ? 1 : 0;
          continue;
        }
        if (typeof answer !== "string" || !answer.trim()) {
          throw new Error("Answer every question before submitting.");
        }
        subjectiveItems.push({
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          answer,
          rubric: question.rubric ?? "",
          referenceAnswer: question.referenceAnswer ?? "",
          language: languages?.[question.id] ?? question.language,
          testCases: question.testCases,
        });
      }

      const results = await gradeSubjectiveBatch(subjectiveItems);
      const resultById = new Map(results.map((result) => [result.id, result]));
      for (const question of questions) {
        if (question.type !== "mcq") {
          totalScore += resultById.get(question.id)?.score ?? 0;
        }
      }
      const score = totalScore / questions.length;
      const passed = score >= preferences.masteryPassThreshold / 100;
      const draft: QuizDraft = {
        ...get().diagnosticDraft,
        answers,
        results,
        score,
      };
      await saveNodeQuizScore(nodeId, score, draft);
      set({ diagnosticDraft: draft, diagnosticScore: score });

      if (passed) {
        const cards = await getNodeFlashcards(nodeId);
        const scheduledCards = cards.map((card) =>
          scheduleNextReview(card, 2)
        );
        await updateFlashcardSchedules(scheduledCards);
        const workspaceId = get().activeWorkspaceId;
        if (workspaceId) {
          const dueCards = await getDueFlashcards(workspaceId);
          const { preferences } = get();
          const remaining =
            preferences.dailyReviewLimit === 0
              ? dueCards.length
              : Math.max(
                  0,
                  preferences.dailyReviewLimit - getReviewsCompletedToday()
                );
          set({ dueCards: dueCards.slice(0, remaining) });
        }
        await get().markNodeMastered(nodeId, score);
      }

      return { score, passed, results };
    } catch (error) {
      set({
        diagnosticError:
          error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      set({ isSubmittingDiagnostic: false });
    }
  },

  refreshNodeQuizAvailability: async (nodeId: string) => {
    try {
      const exists = await hasNodeQuiz(nodeId);
      if (exists) {
        const quizNodeIds = new Set(get().quizNodeIds);
        quizNodeIds.add(nodeId);
        set({ quizNodeIds });
      }
    } catch (err) {
      get().showToast(
        err instanceof Error ? err.message : "Failed to check saved quiz."
      );
    } finally {
      const checkedQuizNodeIds = new Set(get().checkedQuizNodeIds);
      checkedQuizNodeIds.add(nodeId);
      set({ checkedQuizNodeIds });
    }
  },

  clearQuizAvailability: () => set({ quizNodeIds: new Set() }),

  gradeDueCard: async (card: DueFlashcard, grade: ReviewGrade) => {
    const updated = scheduleNextReview(card, grade);
    await updateFlashcardSchedule(updated);

    const wsId = get().activeWorkspaceId;
    if (wsId) {
      const dueCards = await getDueFlashcards(wsId);
      const { preferences } = get();
      const completedToday = recordCompletedReview();
      const remaining =
        preferences.dailyReviewLimit === 0
          ? dueCards.length
          : Math.max(
              0,
              preferences.dailyReviewLimit - completedToday
            );
      set({ dueCards: dueCards.slice(0, remaining) });
    } else {
      recordCompletedReview();
      set({ dueCards: get().dueCards.filter((c) => c.id !== card.id) });
    }
  },

  refreshDocuments: async () => {
    const wsId = get().activeWorkspaceId ?? undefined;
    const documents = await listDocuments(wsId);
    set({ documents });
  },

  removeDocument: async (docId: string) => {
    await deleteDocument(docId);
    set({ documents: get().documents.filter((d) => d.id !== docId) });
  },

  setActiveModal: (modal) => set({ activeModal: modal }),
  setTutorOpen: (open) => set({ isTutorOpen: open }),
  setPreferences: async (preferences) => {
    saveUserPreferences(preferences);
    set({ preferences });
    const workspaceId = get().activeWorkspaceId;
    if (workspaceId) {
      const dueCards = await getDueFlashcards(workspaceId);
      const remaining =
        preferences.dailyReviewLimit === 0
          ? dueCards.length
          : Math.max(
              0,
              preferences.dailyReviewLimit - getReviewsCompletedToday()
            );
      set({ dueCards: dueCards.slice(0, remaining) });
    }
  },
  showToast: (msg) => {
    set({ toastMessage: msg });
    if (msg) {
      setTimeout(() => {
        if (get().toastMessage === msg) {
          set({ toastMessage: null });
        }
      }, 4000);
    }
  },
}));