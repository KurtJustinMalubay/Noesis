import { create } from "zustand";
import type {
  CanvasLayoutMode,
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
  updateWorkspaceLayoutMode,
} from "../db/repositories/workspaceRepo";
import {
  deleteConceptNode,
  deleteGraphEdge,
  getWorkspaceGraph,
  hydrateNodeBatch,
  insertConceptNode,
  insertGraphEdge,
  updateConceptNode,
  updateGraphNodeState,
  updateNodePosition,
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
  type QuizBatchProgress,
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
import {
  computeMasteryCascade,
  recomputeGraphState,
} from "../engine/masteryCascade";
import { canReach } from "../engine/dagTopology";
import { computeSugiyamaLayout } from "../engine/sugiyamaLayout";
import { scheduleNextReview, type ReviewGrade } from "../engine/sm2Scheduler";
import {
  hasConfiguredApiKey,
  getReviewsCompletedToday,
  loadUserPreferences,
  recordCompletedReview,
  saveUserPreferences,
  type UserPreferences,
} from "../ai/keyStore";
import type {
  CurriculumProgress,
  CurriculumSourceDocument,
} from "../ai/curriculumService";

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
  diagnosticProgress: QuizBatchProgress | null;
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
  generateNewCurriculum: (
    topicPrompt: string,
    sourceDocument?: CurriculumSourceDocument
  ) => Promise<void>;
  cancelCurriculumGeneration: () => void;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  setCanvasLayoutMode: (mode: CanvasLayoutMode) => Promise<void>;
  moveGraphNode: (nodeId: string, x: number, y: number) => Promise<void>;
  realignGraphGrid: () => Promise<void>;
  addConceptNode: (input: {
    title: string;
    summary: string;
    x: number;
    y: number;
  }) => Promise<string>;
  editConceptNode: (
    nodeId: string,
    title: string,
    summary: string
  ) => Promise<void>;
  removeConceptNode: (nodeId: string) => Promise<void>;
  connectConceptNodes: (sourceId: string, targetId: string) => Promise<void>;
  disconnectConceptNodes: (sourceId: string, targetId: string) => Promise<void>;
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
  diagnosticProgress: null,
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

  generateNewCurriculum: async (topicPrompt, sourceDocument) => {
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
        controller.signal,
        sourceDocument
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

  setCanvasLayoutMode: async (mode) => {
    const workspaceId = get().activeWorkspaceId;
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspaceId || !workspace || workspace.layout_mode === mode) return;

    const { nodes, edges } = get();
    const graphState = recomputeGraphState(nodes, edges).updatedNodes;
    const positionedNodes = computeSugiyamaLayout(graphState, edges);
    await updateGraphNodeState(positionedNodes);
    await updateWorkspaceLayoutMode(workspaceId, mode);
    set({
      nodes: positionedNodes,
      nodeIndex: new Map(positionedNodes.map((node, index) => [node.id, index])),
      workspaces: get().workspaces.map((item) =>
        item.id === workspaceId ? { ...item, layout_mode: mode } : item
      ),
    });
  },

  moveGraphNode: async (nodeId, x, y) => {
    const workspaceId = get().activeWorkspaceId;
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!workspaceId || !node || node.workspace_id !== workspaceId) return;
    await updateNodePosition(workspaceId, nodeId, x, y);
    const nodes = get().nodes.map((item) =>
      item.id === nodeId ? { ...item, pos_x: x, pos_y: y } : item
    );
    set({ nodes });
  },

  realignGraphGrid: async () => {
    const nodes = get().nodes.map((node) => ({
      ...node,
      pos_x: Math.round(node.pos_x / 16) * 16,
      pos_y: Math.round(node.pos_y / 16) * 16,
    }));
    await updateGraphNodeState(nodes);
    set({ nodes });
  },

  addConceptNode: async ({ title, summary, x, y }) => {
    const workspaceId = get().activeWorkspaceId;
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspaceId || !workspace) {
      throw new Error("Select a workspace before adding a concept.");
    }
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error("Concept title is required.");

    const node: GraphNode = {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      title: cleanTitle,
      summary_hint: summary.trim(),
      status: "unlocked",
      mastery_score: 0,
      in_degree_unmastered: 0,
      layer_index: 0,
      pos_x: x,
      pos_y: y,
      is_hydrated: 0,
      lesson_markdown: null,
      mermaid_diagram: null,
      source_citations: null,
      updated_at: Date.now(),
    };
    const edges = get().edges;
    const graphState = recomputeGraphState([...get().nodes, node], edges);
    const nextNodes =
      workspace.layout_mode === "auto"
        ? computeSugiyamaLayout(graphState.updatedNodes, edges)
        : graphState.updatedNodes;
    await insertConceptNode(nextNodes.find((item) => item.id === node.id)!);
    await updateGraphNodeState(nextNodes);
    set({
      nodes: nextNodes,
      nodeIndex: new Map(nextNodes.map((item, index) => [item.id, index])),
    });
    return node.id;
  },

  editConceptNode: async (nodeId, title, summary) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error("Concept title is required.");
    await updateConceptNode(nodeId, cleanTitle, summary.trim());
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, title: cleanTitle, summary_hint: summary.trim() }
          : node
      ),
    });
  },

  removeConceptNode: async (nodeId) => {
    const workspaceId = get().activeWorkspaceId;
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!workspaceId || !node || node.workspace_id !== workspaceId) return;
    const nextNodes = get().nodes.filter((item) => item.id !== nodeId);
    const nextEdges = get().edges.filter(
      (edge) => edge.source_id !== nodeId && edge.target_id !== nodeId
    );
    const graphState = recomputeGraphState(nextNodes, nextEdges);
    const positionedNodes =
      get().workspaces.find((item) => item.id === workspaceId)?.layout_mode ===
      "auto"
        ? computeSugiyamaLayout(graphState.updatedNodes, nextEdges)
        : graphState.updatedNodes;
    await deleteConceptNode(nodeId);
    await updateGraphNodeState(positionedNodes);
    const quizNodeIds = new Set(get().quizNodeIds);
    quizNodeIds.delete(nodeId);
    const checkedQuizNodeIds = new Set(get().checkedQuizNodeIds);
    checkedQuizNodeIds.delete(nodeId);
    set({
      nodes: positionedNodes,
      nodeIndex: new Map(
        positionedNodes.map((item, index) => [item.id, index])
      ),
      edges: nextEdges,
      selectedNodeId:
        get().selectedNodeId === nodeId ? null : get().selectedNodeId,
      quizNodeIds,
      checkedQuizNodeIds,
    });
  },

  connectConceptNodes: async (sourceId, targetId) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) throw new Error("Select a workspace first.");
    const { nodes, edges } = get();
    if (sourceId === targetId) {
      throw new Error("Cannot connect a concept to itself.");
    }
    if (
      !nodes.some((node) => node.id === sourceId) ||
      !nodes.some((node) => node.id === targetId)
    ) {
      throw new Error("Both concepts must be in the active workspace.");
    }
    if (
      edges.some(
        (edge) => edge.source_id === sourceId && edge.target_id === targetId
      )
    ) {
      throw new Error("These concepts are already connected.");
    }
    if (canReach(edges, targetId, sourceId)) {
      throw new Error("Cannot connect: circular prerequisite detected.");
    }

    const edge: GraphEdge = {
      workspace_id: workspaceId,
      source_id: sourceId,
      target_id: targetId,
    };
    const nextEdges = [...edges, edge];
    const graphState = recomputeGraphState(nodes, nextEdges);
    const nextNodes =
      get().workspaces.find((item) => item.id === workspaceId)?.layout_mode ===
      "auto"
        ? computeSugiyamaLayout(graphState.updatedNodes, nextEdges)
        : graphState.updatedNodes;
    await insertGraphEdge(edge);
    await updateGraphNodeState(nextNodes);
    set({
      edges: nextEdges,
      nodes: nextNodes,
      nodeIndex: new Map(nextNodes.map((node, index) => [node.id, index])),
    });
  },

  disconnectConceptNodes: async (sourceId, targetId) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const nextEdges = get().edges.filter(
      (edge) =>
        !(edge.source_id === sourceId && edge.target_id === targetId)
    );
    if (nextEdges.length === get().edges.length) return;
    const graphState = recomputeGraphState(get().nodes, nextEdges);
    const nextNodes =
      get().workspaces.find((item) => item.id === workspaceId)?.layout_mode ===
      "auto"
        ? computeSugiyamaLayout(graphState.updatedNodes, nextEdges)
        : graphState.updatedNodes;
    await deleteGraphEdge(workspaceId, sourceId, targetId);
    await updateGraphNodeState(nextNodes);
    set({
      edges: nextEdges,
      nodes: nextNodes,
      nodeIndex: new Map(nextNodes.map((node, index) => [node.id, index])),
    });
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
        await hydrateNodeBatch(
          node.id,
          hydrated.lessonMarkdown,
          hydrated.mermaidDiagram,
          JSON.stringify(hydrated.citations),
          hydrated.flashcards
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
      diagnosticProgress: null,
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
      diagnosticProgress: null,
      isConfiguringDiagnostic: false,
      diagnosticError: null,
    });
    try {
      const questions = await generateNodeQuiz(node, config, (progress) =>
        set({ diagnosticProgress: progress })
      );
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
      set({ isLoadingDiagnostic: false, diagnosticProgress: null });
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