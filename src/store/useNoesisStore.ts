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
  createWorkspace,
  getWorkspaceProgressSummaries,
  archiveWorkspace as archiveWorkspaceRecord,
  listArchivedWorkspaces,
  listWorkspaces,
  permanentlyDeleteWorkspace as permanentlyDeleteWorkspaceRecord,
  restoreWorkspace as restoreWorkspaceRecord,
  updateWorkspaceLayoutMode,
  type WorkspaceProgressSummary,
} from "../db/repositories/workspaceRepo";
import { deleteGeneratedWorkspace } from "../db/repositories/curriculumRepo";
import {
  archiveConceptNode as archiveConceptNodeRecord,
  deleteGraphEdge,
  getWorkspaceGraph,
  hydrateNodeBatch,
  insertConceptNode,
  insertGraphEdge,
  permanentlyDeleteArchivedConceptNode as permanentlyDeleteArchivedConceptNodeRecord,
  restoreWorkspaceGraphSnapshot,
  restoreArchivedConceptNode as restoreArchivedConceptNodeRecord,
  updateConceptNode,
  updateGraphNodeState,
  updateNodeLessonContent,
  updateNodePosition,
  updateNodesStatusBatch,
} from "../db/repositories/graphRepo";
import {
  getDueFlashcards,
  getWorkspaceFlashcards,
  getNodeFlashcards,
  insertFlashcard,
  deleteFlashcard as deleteFlashcardRecord,
  updateFlashcardContent,
  updateFlashcardSchedule,
  updateFlashcardSchedules,
  type DueFlashcard,
  type WorkspaceFlashcard,
} from "../db/repositories/flashcardRepo";
import {
  deleteDocument,
  listDocuments,
  searchVaultFts,
  type StoredDocument,
} from "../db/repositories/documentRepo";
import {
  generateWorkspaceCurriculum,
  generateLessonFlashcards,
  generateLessonMaterial,
  hydrateNodeContent,
} from "../ai/curriculumService";
import { serializeLessonGeneration } from "../ai/lessonGenerationQueue";
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
import { usePluginStore } from "../plugins/pluginStore";
import { FLASHCARDS_PLUGIN_ID } from "../plugins/registry";
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
  | "new_workspace"
  | "profile";

interface GraphSnapshot {
  workspaceId: string;
  layoutMode: CanvasLayoutMode;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function createGraphSnapshot(
  workspaceId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  layoutMode: CanvasLayoutMode
): GraphSnapshot {
  return {
    workspaceId,
    layoutMode,
    nodes: nodes.map((node) => ({ ...node })),
    edges: edges.map((edge) => ({ ...edge })),
  };
}

function appendGraphSnapshot(
  history: GraphSnapshot[],
  snapshot: GraphSnapshot
): GraphSnapshot[] {
  return [...history, snapshot].slice(-10);
}

let workspaceSelectionGeneration = 0;

function areFlashcardsEnabled(): boolean {
  return usePluginStore
    .getState()
    .enabledPluginIds.includes(FLASHCARDS_PLUGIN_ID);
}

interface NoesisState {
  // Core entities
  workspaces: Workspace[];
  archivedWorkspaces: Workspace[];
  workspaceDeletionRevision: number;
  workspaceProgress: Record<string, WorkspaceProgressSummary>;
  activeWorkspaceId: string | null;
  nodes: GraphNode[];
  nodeIndex: Map<string, number>;
  edges: GraphEdge[];
  selectedNodeId: string | null;
  undoStack: GraphSnapshot[];
  redoStack: GraphSnapshot[];
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
  lessonGenerationText: Map<string, string>;
  flashcardCounts: Map<string, number>;
  generatingFlashcardNodeIds: Set<string>;
  diagnosticQuestions: QuizQuestion[];
  diagnosticConfig: QuizGenerationConfig | null;
  diagnosticDraft: QuizDraft;
  diagnosticScore: number | null;
  isLoadingDiagnostic: boolean;
  diagnosticProgress: QuizBatchProgress | null;
  diagnosticAbortController: AbortController | null;
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
  createManualWorkspace: (title: string, rootDomain?: string) => Promise<void>;
  generateNewCurriculum: (
    topicPrompt: string,
    sourceDocument?: CurriculumSourceDocument
  ) => Promise<boolean>;
  cancelCurriculumGeneration: () => void;
  archiveWorkspace: (workspaceId: string) => Promise<void>;
  restoreWorkspace: (workspaceId: string) => Promise<void>;
  permanentlyDeleteWorkspace: (workspaceId: string) => Promise<void>;
  reconcileDeletedWorkspaces: (workspaceIds: string[]) => Promise<void>;
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
  archiveConceptNode: (nodeId: string) => Promise<void>;
  restoreArchivedConceptNode: (
    workspaceId: string,
    nodeId: string
  ) => Promise<void>;
  permanentlyDeleteArchivedConceptNode: (
    workspaceId: string,
    nodeId: string
  ) => Promise<void>;
  connectConceptNodes: (sourceId: string, targetId: string) => Promise<void>;
  disconnectConceptNodes: (sourceId: string, targetId: string) => Promise<void>;
  undoGraph: () => Promise<void>;
  redoGraph: () => Promise<void>;
  selectNode: (nodeId: string | null) => Promise<void>;
  regenerateNodeLesson: (nodeId: string) => Promise<void>;
  generateNodeFlashcards: (nodeId: string) => Promise<void>;
  generateFlashcardsForTopic: (
    nodeId: string,
    topic: string
  ) => Promise<WorkspaceFlashcard[]>;
  markNodeMastered: (nodeId: string, score?: number) => Promise<void>;
  openDiagnosticForNode: (nodeId: string) => Promise<void>;
  configureDiagnosticForNode: (nodeId: string) => void;
  cancelDiagnosticConfiguration: () => void;
  generateConfiguredDiagnostic: (
    nodeId: string,
    config: QuizGenerationConfig
  ) => Promise<void>;
  cancelDiagnosticGeneration: () => void;
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
  loadWorkspaceFlashcards: (
    workspaceId: string
  ) => Promise<WorkspaceFlashcard[]>;
  createFlashcard: (
    nodeId: string,
    front: string,
    back: string
  ) => Promise<WorkspaceFlashcard>;
  editFlashcard: (
    card: WorkspaceFlashcard,
    front: string,
    back: string
  ) => Promise<WorkspaceFlashcard>;
  removeFlashcard: (card: WorkspaceFlashcard) => Promise<void>;
  refreshDocuments: () => Promise<void>;
  removeDocument: (docId: string) => Promise<void>;
  setActiveModal: (modal: ActiveModal) => void;
  setTutorOpen: (open: boolean) => void;
  setPreferences: (preferences: UserPreferences) => Promise<void>;
  showToast: (msg: string | null) => void;
}

export const useNoesisStore = create<NoesisState>((set, get) => ({
  workspaces: [],
  archivedWorkspaces: [],
  workspaceDeletionRevision: 0,
  workspaceProgress: {},
  activeWorkspaceId: null,
  nodes: [],
  nodeIndex: new Map(),
  edges: [],
  selectedNodeId: null,
  undoStack: [],
  redoStack: [],
  dueCards: [],
  documents: [],

  activeModal: "none",
  isTutorOpen: false,
  isGeneratingCurriculum: false,
  curriculumAbortController: null,
  curriculumProgress: null,
  hydratingNodeIds: new Set(),
  hydrationErrors: new Map(),
  lessonGenerationText: new Map(),
  flashcardCounts: new Map(),
  generatingFlashcardNodeIds: new Set(),
  diagnosticQuestions: [],
  diagnosticConfig: null,
  diagnosticDraft: { answers: {}, currentQuestionIndex: 0 },
  diagnosticScore: null,
  isLoadingDiagnostic: false,
  diagnosticProgress: null,
  diagnosticAbortController: null,
  isSubmittingDiagnostic: false,
  isConfiguringDiagnostic: false,
  diagnosticError: null,
  quizNodeIds: new Set(),
  checkedQuizNodeIds: new Set(),
  toastMessage: null,
  preferences: loadUserPreferences(),

  initAppData: async () => {
    const [workspaces, archivedWorkspaces, documents] = await Promise.all([
      listWorkspaces(),
      listArchivedWorkspaces(),
      listDocuments(),
    ]);

    set({ workspaces, archivedWorkspaces, documents });

    if (workspaces.length > 0) {
      await get().selectWorkspace(workspaces[0].id);
    } else {
      set({ workspaceProgress: await getWorkspaceProgressSummaries() });
      if (!hasConfiguredApiKey()) {
        set({ activeModal: "settings" });
      } else {
        set({ activeModal: "new_workspace" });
      }
    }
  },

  selectWorkspace: async (workspaceId: string) => {
    const workspace = get().workspaces.find(
      (item) => item.id === workspaceId && item.archived_at === null
    );
    if (!workspace) {
      throw new Error("The workspace is archived or no longer available.");
    }
    const requestGeneration = ++workspaceSelectionGeneration;
    const [
      { nodes, edges },
      dueCards,
      documents,
      workspaceProgress,
    ] =
      await Promise.all([
        getWorkspaceGraph(workspaceId),
        getDueFlashcards(workspaceId),
        listDocuments(workspaceId),
        getWorkspaceProgressSummaries(),
      ]);
    if (requestGeneration !== workspaceSelectionGeneration) return;

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
      workspaceProgress,
      nodes,
      nodeIndex: new Map(nodes.map((node, index) => [node.id, index])),
      edges,
      dueCards: dueCards.slice(0, remainingReviews),
      documents,
      selectedNodeId: null,
      undoStack: [],
      redoStack: [],
      quizNodeIds: new Set(),
      checkedQuizNodeIds: new Set(),
    });
  },

  createManualWorkspace: async (title, rootDomain) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      throw new Error("Workspace name is required.");
    }

    const now = Date.now();
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      title: cleanTitle,
      root_domain: rootDomain?.trim() || "General",
      layout_mode: "free",
      created_at: now,
      updated_at: now,
      archived_at: null,
    };
    await createWorkspace(workspace);
    set({
      workspaces: [workspace, ...get().workspaces],
      activeModal: "none",
    });
    await get().selectWorkspace(workspace.id);
    get().showToast(`Workspace "${workspace.title}" created.`);
  },

  generateNewCurriculum: async (topicPrompt, sourceDocument) => {
    if (get().isGeneratingCurriculum) return false;
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
      if (controller.signal.aborted) {
        await deleteGeneratedWorkspace(workspace.id);
        throw new DOMException("Curriculum generation stopped.", "AbortError");
      }
      workspaceSelectionGeneration += 1;
      const workspaces = [workspace, ...get().workspaces];
      set({
        workspaces,
        activeWorkspaceId: workspace.id,
        nodes,
        nodeIndex: new Map(nodes.map((node, index) => [node.id, index])),
        edges,
        selectedNodeId: null,
        undoStack: [],
        redoStack: [],
        dueCards: [],
        activeModal: "none",
        curriculumProgress: null,
      });
      get().showToast(
        `Generated workspace with ${nodes.length} concepts: "${workspace.title}"`
      );
      return true;
    } catch (error) {
      if (
        controller.signal.aborted &&
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        get().showToast("Curriculum generation stopped.");
        return false;
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

  archiveWorkspace: async (workspaceId: string) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      throw new Error("The workspace is no longer available to archive.");
    }
    const archivedAt = Date.now();
    await archiveWorkspaceRecord(workspaceId, archivedAt);
    const remaining = get().workspaces.filter(
      (item) => item.id !== workspaceId
    );
    const wasActiveWorkspace = get().activeWorkspaceId === workspaceId;
    if (wasActiveWorkspace) workspaceSelectionGeneration += 1;
    set({
      workspaces: remaining,
      workspaceProgress: Object.fromEntries(
        Object.entries(get().workspaceProgress).filter(
          ([id]) => id !== workspaceId
        )
      ),
      archivedWorkspaces: [
        { ...workspace, archived_at: archivedAt },
        ...get().archivedWorkspaces.filter((item) => item.id !== workspaceId),
      ],
      ...(wasActiveWorkspace
        ? {
            activeWorkspaceId: null,
            nodes: [],
            nodeIndex: new Map(),
            edges: [],
            selectedNodeId: null,
            dueCards: [],
            documents: [],
          }
        : {}),
    });

    if (wasActiveWorkspace) {
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

  restoreWorkspace: async (workspaceId) => {
    const workspace = get().archivedWorkspaces.find(
      (item) => item.id === workspaceId
    );
    if (!workspace) {
      throw new Error("The archived workspace is no longer available.");
    }
    await restoreWorkspaceRecord(workspaceId);
    const workspaceProgress = await getWorkspaceProgressSummaries();
    set({
      workspaces: [...get().workspaces, { ...workspace, archived_at: null }].sort(
        (left, right) => right.updated_at - left.updated_at
      ),
      workspaceProgress,
      archivedWorkspaces: get().archivedWorkspaces.filter(
        (item) => item.id !== workspaceId
      ),
    });
  },

  permanentlyDeleteWorkspace: async (workspaceId) => {
    await permanentlyDeleteWorkspaceRecord(workspaceId);
    set({
      archivedWorkspaces: get().archivedWorkspaces.filter(
        (item) => item.id !== workspaceId
      ),
      workspaceProgress: Object.fromEntries(
        Object.entries(get().workspaceProgress).filter(
          ([id]) => id !== workspaceId
        )
      ),
      workspaceDeletionRevision: get().workspaceDeletionRevision + 1,
    });
  },

  reconcileDeletedWorkspaces: async (workspaceIds) => {
    const deletedIds = new Set(workspaceIds);
    const current = get();
    const remaining = current.workspaces.filter(
      (workspace) => !deletedIds.has(workspace.id)
    );
    const activeWasDeleted =
      current.activeWorkspaceId !== null &&
      deletedIds.has(current.activeWorkspaceId);
    if (activeWasDeleted) workspaceSelectionGeneration += 1;
    set({
      workspaces: remaining,
      archivedWorkspaces: current.archivedWorkspaces.filter(
        (workspace) => !deletedIds.has(workspace.id)
      ),
      workspaceDeletionRevision:
        current.workspaceDeletionRevision + (workspaceIds.length > 0 ? 1 : 0),
      workspaceProgress: Object.fromEntries(
        Object.entries(current.workspaceProgress).filter(
          ([workspaceId]) => !deletedIds.has(workspaceId)
        )
      ),
      ...(activeWasDeleted
        ? {
            activeWorkspaceId: null,
            nodes: [],
            nodeIndex: new Map(),
            edges: [],
            selectedNodeId: null,
            dueCards: [],
            documents: [],
          }
        : {}),
    });

    if (!activeWasDeleted) return;
    if (remaining.length > 0) {
      await get().selectWorkspace(remaining[0].id);
      return;
    }
    const documents = await listDocuments();
    set({ documents });
  },

  setCanvasLayoutMode: async (mode) => {
    const workspaceId = get().activeWorkspaceId;
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspaceId || !workspace || workspace.layout_mode === mode) return;

    const { nodes, edges } = get();
    const previousSnapshot = createGraphSnapshot(
      workspaceId,
      nodes,
      edges,
      workspace.layout_mode
    );
    const graphState = recomputeGraphState(nodes, edges).updatedNodes;
    const positionedNodes = computeSugiyamaLayout(graphState, edges);
    await updateGraphNodeState(positionedNodes);
    await updateWorkspaceLayoutMode(workspaceId, mode);
    set({
      nodes: positionedNodes,
      nodeIndex: new Map(positionedNodes.map((node, index) => [node.id, index])),
      undoStack: appendGraphSnapshot(get().undoStack, previousSnapshot),
      redoStack: [],
      workspaces: get().workspaces.map((item) =>
        item.id === workspaceId ? { ...item, layout_mode: mode } : item
      ),
    });
  },

  moveGraphNode: async (nodeId, x, y) => {
    const workspaceId = get().activeWorkspaceId;
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!workspaceId || !node || node.workspace_id !== workspaceId) return;
    if (node.pos_x === x && node.pos_y === y) return;
    const previousSnapshot = createGraphSnapshot(
      workspaceId,
      get().nodes,
      get().edges,
      get().workspaces.find((item) => item.id === workspaceId)?.layout_mode ??
        "free"
    );
    await updateNodePosition(workspaceId, nodeId, x, y);
    const nodes = get().nodes.map((item) =>
      item.id === nodeId ? { ...item, pos_x: x, pos_y: y } : item
    );
    set({
      nodes,
      undoStack: appendGraphSnapshot(get().undoStack, previousSnapshot),
      redoStack: [],
    });
  },

  realignGraphGrid: async () => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const nodes = get().nodes.map((node) => ({
      ...node,
      pos_x: Math.round(node.pos_x / 16) * 16,
      pos_y: Math.round(node.pos_y / 16) * 16,
    }));
    if (
      nodes.every(
        (node, index) =>
          node.pos_x === get().nodes[index]?.pos_x &&
          node.pos_y === get().nodes[index]?.pos_y
      )
    ) {
      return;
    }
    const previousSnapshot = createGraphSnapshot(
      workspaceId,
      get().nodes,
      get().edges,
      get().workspaces.find((item) => item.id === workspaceId)?.layout_mode ??
        "free"
    );
    await updateGraphNodeState(nodes);
    set({
      nodes,
      undoStack: appendGraphSnapshot(get().undoStack, previousSnapshot),
      redoStack: [],
    });
  },

  addConceptNode: async ({ title, summary, x, y }) => {
    const workspaceId = get().activeWorkspaceId;
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspaceId || !workspace) {
      throw new Error("Select a workspace before adding a concept.");
    }
    const previousSnapshot = createGraphSnapshot(
      workspaceId,
      get().nodes,
      get().edges,
      workspace.layout_mode
    );
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
      archived_at: null,
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
      undoStack: appendGraphSnapshot(get().undoStack, previousSnapshot),
      redoStack: [],
    });
    return node.id;
  },

  editConceptNode: async (nodeId, title, summary) => {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error("Concept title is required.");
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) throw new Error("Select a workspace first.");
    const previousSnapshot = createGraphSnapshot(
      workspaceId,
      get().nodes,
      get().edges,
      get().workspaces.find((item) => item.id === workspaceId)?.layout_mode ??
        "free"
    );
    await updateConceptNode(nodeId, cleanTitle, summary.trim());
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, title: cleanTitle, summary_hint: summary.trim() }
          : node
      ),
      undoStack: appendGraphSnapshot(get().undoStack, previousSnapshot),
      redoStack: [],
    });
  },

  archiveConceptNode: async (nodeId) => {
    const workspaceId = get().activeWorkspaceId;
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!workspaceId || !node || node.workspace_id !== workspaceId) return;
    const previousSnapshot = createGraphSnapshot(
      workspaceId,
      get().nodes,
      get().edges,
      get().workspaces.find((item) => item.id === workspaceId)?.layout_mode ??
        "free"
    );
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
    await archiveConceptNodeRecord(workspaceId, nodeId);
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
      undoStack: appendGraphSnapshot(get().undoStack, previousSnapshot),
      redoStack: [],
      dueCards: get().dueCards.filter((card) => card.node_id !== nodeId),
      selectedNodeId:
        get().selectedNodeId === nodeId ? null : get().selectedNodeId,
      quizNodeIds,
      checkedQuizNodeIds,
    });
  },

  restoreArchivedConceptNode: async (workspaceId, nodeId) => {
    if (get().activeWorkspaceId !== workspaceId) {
      throw new Error("Open the concept's workspace before restoring it.");
    }
    await restoreArchivedConceptNodeRecord(workspaceId, nodeId);
    const { nodes, edges } = await getWorkspaceGraph(workspaceId);
    const graphState = recomputeGraphState(nodes, edges);
    const layoutMode = get().workspaces.find(
      (workspace) => workspace.id === workspaceId
    )?.layout_mode;
    const positionedNodes =
      layoutMode === "auto"
        ? computeSugiyamaLayout(graphState.updatedNodes, edges)
        : graphState.updatedNodes;
    await updateGraphNodeState(positionedNodes);
    const dueCards = await getDueFlashcards(workspaceId);
    const preferences = get().preferences;
    const remainingReviews =
      preferences.dailyReviewLimit === 0
        ? dueCards.length
        : Math.max(
            0,
            preferences.dailyReviewLimit - getReviewsCompletedToday()
          );
    if (get().activeWorkspaceId !== workspaceId) return;
    set({
      nodes: positionedNodes,
      nodeIndex: new Map(
        positionedNodes.map((item, index) => [item.id, index])
      ),
      edges,
      dueCards: dueCards.slice(0, remainingReviews),
      selectedNodeId: null,
    });
  },

  permanentlyDeleteArchivedConceptNode: async (workspaceId, nodeId) => {
    await permanentlyDeleteArchivedConceptNodeRecord(workspaceId, nodeId);
    set({ undoStack: [], redoStack: [] });
  },

  connectConceptNodes: async (sourceId, targetId) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) throw new Error("Select a workspace first.");
    const { nodes, edges } = get();
    const previousSnapshot = createGraphSnapshot(
      workspaceId,
      nodes,
      edges,
      get().workspaces.find((item) => item.id === workspaceId)?.layout_mode ??
        "free"
    );
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
      undoStack: appendGraphSnapshot(get().undoStack, previousSnapshot),
      redoStack: [],
    });
  },

  disconnectConceptNodes: async (sourceId, targetId) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const previousSnapshot = createGraphSnapshot(
      workspaceId,
      get().nodes,
      get().edges,
      get().workspaces.find((item) => item.id === workspaceId)?.layout_mode ??
        "free"
    );
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
      undoStack: appendGraphSnapshot(get().undoStack, previousSnapshot),
      redoStack: [],
    });
  },

  undoGraph: async () => {
    const state = get();
    const workspaceId = state.activeWorkspaceId;
    const target = state.undoStack[state.undoStack.length - 1];
    if (!workspaceId || !target || target.workspaceId !== workspaceId) return;
    const currentSnapshot = createGraphSnapshot(
      workspaceId,
      state.nodes,
      state.edges,
      state.workspaces.find((item) => item.id === workspaceId)?.layout_mode ??
        "free"
    );
    await restoreWorkspaceGraphSnapshot(
      workspaceId,
      target.nodes,
      target.edges,
      state.nodes,
      target.layoutMode
    );
    const dueCards = await getDueFlashcards(workspaceId);
    const remainingReviews =
      state.preferences.dailyReviewLimit === 0
        ? dueCards.length
        : Math.max(
            0,
            state.preferences.dailyReviewLimit - getReviewsCompletedToday()
          );
    set({
      nodes: target.nodes,
      nodeIndex: new Map(target.nodes.map((node, index) => [node.id, index])),
      edges: target.edges,
      selectedNodeId:
        state.selectedNodeId &&
        target.nodes.some((node) => node.id === state.selectedNodeId)
          ? state.selectedNodeId
          : null,
      dueCards: dueCards.slice(0, remainingReviews),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: appendGraphSnapshot(state.redoStack, currentSnapshot),
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, layout_mode: target.layoutMode }
          : workspace
      ),
      quizNodeIds: new Set(),
      checkedQuizNodeIds: new Set(),
    });
  },

  redoGraph: async () => {
    const state = get();
    const workspaceId = state.activeWorkspaceId;
    const target = state.redoStack[state.redoStack.length - 1];
    if (!workspaceId || !target || target.workspaceId !== workspaceId) return;
    const currentSnapshot = createGraphSnapshot(
      workspaceId,
      state.nodes,
      state.edges,
      state.workspaces.find((item) => item.id === workspaceId)?.layout_mode ??
        "free"
    );
    await restoreWorkspaceGraphSnapshot(
      workspaceId,
      target.nodes,
      target.edges,
      state.nodes,
      target.layoutMode
    );
    const dueCards = await getDueFlashcards(workspaceId);
    const remainingReviews =
      state.preferences.dailyReviewLimit === 0
        ? dueCards.length
        : Math.max(
            0,
            state.preferences.dailyReviewLimit - getReviewsCompletedToday()
          );
    set({
      nodes: target.nodes,
      nodeIndex: new Map(target.nodes.map((node, index) => [node.id, index])),
      edges: target.edges,
      selectedNodeId:
        state.selectedNodeId &&
        target.nodes.some((node) => node.id === state.selectedNodeId)
          ? state.selectedNodeId
          : null,
      dueCards: dueCards.slice(0, remainingReviews),
      redoStack: state.redoStack.slice(0, -1),
      undoStack: appendGraphSnapshot(state.undoStack, currentSnapshot),
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, layout_mode: target.layoutMode }
          : workspace
      ),
      quizNodeIds: new Set(),
      checkedQuizNodeIds: new Set(),
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
    void getNodeFlashcards(nodeId)
      .then((cards) => {
        const flashcardCounts = new Map(get().flashcardCounts);
        flashcardCounts.set(nodeId, cards.length);
        set({ flashcardCounts });
      })
      .catch((error) => {
        get().showToast(
          `Could not check lesson flashcards: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });

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
      const lessonGenerationText = new Map(get().lessonGenerationText);
      lessonGenerationText.set(node.id, "");
      set({ hydratingNodeIds, hydrationErrors, lessonGenerationText });
      let lastProgressUpdate = 0;
      try {
        const hydrated = await serializeLessonGeneration(() =>
          hydrateNodeContent(
            node,
            ws?.title ?? "Noesis Course",
            (text) => {
              const now = Date.now();
              if (text && now - lastProgressUpdate < 100) return;
              lastProgressUpdate = now;
              const progress = new Map(get().lessonGenerationText);
              progress.set(node.id, text);
              set({ lessonGenerationText: progress });
            }
          )
        );
        const progress = new Map(get().lessonGenerationText);
        progress.set(node.id, hydrated.lessonMarkdown);
        set({ lessonGenerationText: progress });
        await hydrateNodeBatch(
          node.id,
          hydrated.lessonMarkdown,
          hydrated.mermaidDiagram,
          JSON.stringify(hydrated.citations),
          []
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
        const lessonGenerationText = new Map(get().lessonGenerationText);
        lessonGenerationText.delete(node.id);
        set({ hydratingNodeIds: remainingHydrations, lessonGenerationText });
      }
    }
  },

  regenerateNodeLesson: async (nodeId) => {
    if (get().hydratingNodeIds.has(nodeId)) return;
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node) return;

    const workspace = get().workspaces.find(
      (item) => item.id === node.workspace_id
    );
    const hydratingNodeIds = new Set(get().hydratingNodeIds);
    hydratingNodeIds.add(nodeId);
    const hydrationErrors = new Map(get().hydrationErrors);
    hydrationErrors.delete(nodeId);
    const lessonGenerationText = new Map(get().lessonGenerationText);
    lessonGenerationText.set(nodeId, "");
    set({ hydratingNodeIds, hydrationErrors, lessonGenerationText });
    let lastProgressUpdate = 0;

    try {
      const generated = await serializeLessonGeneration(() =>
        generateLessonMaterial(
          node,
          workspace?.title ?? "Noesis Course",
          (text) => {
            const now = Date.now();
            if (text && now - lastProgressUpdate < 100) return;
            lastProgressUpdate = now;
            const progress = new Map(get().lessonGenerationText);
            progress.set(nodeId, text);
            set({ lessonGenerationText: progress });
          }
        )
      );
      const progress = new Map(get().lessonGenerationText);
      progress.set(nodeId, generated.lessonMarkdown);
      set({ lessonGenerationText: progress });
      await updateNodeLessonContent(
        nodeId,
        generated.lessonMarkdown,
        generated.mermaidDiagram || null,
        JSON.stringify(generated.citations)
      );
      set((state) => ({
        nodes: state.nodes.map((item) =>
          item.id === nodeId
            ? {
                ...item,
                is_hydrated: 1,
                lesson_markdown: generated.lessonMarkdown,
                mermaid_diagram: generated.mermaidDiagram || null,
                source_citations: JSON.stringify(generated.citations),
              }
            : item
        ),
      }));
      get().showToast("Lesson regenerated.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to regenerate lesson.";
      const nextErrors = new Map(get().hydrationErrors);
      nextErrors.set(nodeId, message);
      set({ hydrationErrors: nextErrors });
      get().showToast(message);
    } finally {
      const remainingHydrations = new Set(get().hydratingNodeIds);
      remainingHydrations.delete(nodeId);
      const lessonGenerationText = new Map(get().lessonGenerationText);
      lessonGenerationText.delete(nodeId);
      set({ hydratingNodeIds: remainingHydrations, lessonGenerationText });
    }
  },

  generateNodeFlashcards: async (nodeId) => {
    if (!areFlashcardsEnabled()) return;
    if (get().generatingFlashcardNodeIds.has(nodeId)) return;
    const node = get().nodes.find((item) => item.id === nodeId);
    const lessonMarkdown = node?.lesson_markdown;
    if (!node || node.is_hydrated !== 1 || !lessonMarkdown?.trim()) {
    get().showToast(
      "Generate the lesson before creating its flashcards."
    );
    return;
    }

    const generatingFlashcardNodeIds = new Set(
    get().generatingFlashcardNodeIds
    );
    generatingFlashcardNodeIds.add(nodeId);
    set({ generatingFlashcardNodeIds });
    try {
    const existingCards = await getNodeFlashcards(nodeId);
    if (existingCards.length > 0) {
      const flashcardCounts = new Map(get().flashcardCounts);
      flashcardCounts.set(nodeId, existingCards.length);
      set({ flashcardCounts });
      get().showToast("Flashcards already exist for this lesson.");
      return;
    }

    const cards = await serializeLessonGeneration(() =>
      generateLessonFlashcards(node, lessonMarkdown)
    );
    if (!areFlashcardsEnabled()) return;
    await updateFlashcardSchedules(cards);
      const flashcardCounts = new Map(get().flashcardCounts);
    flashcardCounts.set(nodeId, cards.length);
    set({ flashcardCounts });

    try {
      const dueCards = await getDueFlashcards(node.workspace_id);
      set({ dueCards });
    } catch (error) {
      get().showToast(
        `Flashcards were saved, but the review queue could not be refreshed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    get().showToast(`Generated ${cards.length} flashcards.`);
    } catch (error) {
      get().showToast(
      `Flashcard generation failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
    const remaining = new Set(get().generatingFlashcardNodeIds);
    remaining.delete(nodeId);
    set({ generatingFlashcardNodeIds: remaining });
    }
  },

  generateFlashcardsForTopic: async (nodeId, topic) => {
    if (!areFlashcardsEnabled()) {
      throw new Error("Enable the Flashcards plugin to generate cards.");
    }
    if (get().generatingFlashcardNodeIds.has(nodeId)) {
      throw new Error("Flashcards are already being generated for this lesson.");
    }
    const node = get().nodes.find(
      (item) =>
        item.id === nodeId && item.workspace_id === get().activeWorkspaceId
    );
    if (!node || node.is_hydrated !== 1 || !node.lesson_markdown?.trim()) {
      throw new Error("Generate this lesson before creating its flashcards.");
    }
    const generating = new Set(get().generatingFlashcardNodeIds);
    generating.add(nodeId);
    set({ generatingFlashcardNodeIds: generating });
    try {
      const query = [topic.trim(), node.title, node.summary_hint]
        .filter(Boolean)
        .join(" ");
      const retrieved = await searchVaultFts(query, 6, node.workspace_id);
      const vaultContext = retrieved
        .map(
          (chunk, index) =>
            `[Source ${index + 1}: ${chunk.file_name}${chunk.heading ? ` > ${chunk.heading}` : ""}]\n${chunk.content.slice(0, 900)}`
        )
        .join("\n\n---\n\n");
      const cards = await serializeLessonGeneration(() =>
        generateLessonFlashcards(
          node,
          node.lesson_markdown ?? "",
          topic,
          vaultContext
        )
      );
      if (!areFlashcardsEnabled()) {
        throw new Error("Flashcards were disabled before generation finished.");
      }
      await updateFlashcardSchedules(cards);
      const flashcardCounts = new Map(get().flashcardCounts);
      const previousCount =
        flashcardCounts.get(nodeId) ?? (await getNodeFlashcards(nodeId)).length;
      flashcardCounts.set(nodeId, previousCount + cards.length);
      set({ flashcardCounts });
      const dueCards = await getDueFlashcards(node.workspace_id);
      const dailyLimit = get().preferences.dailyReviewLimit;
      const remainingReviews =
        dailyLimit === 0
          ? dueCards.length
          : Math.max(0, dailyLimit - getReviewsCompletedToday());
      set({ dueCards: dueCards.slice(0, remainingReviews) });
      return cards.map((card) => ({ ...card, node_title: node.title }));
    } finally {
      const remaining = new Set(get().generatingFlashcardNodeIds);
      remaining.delete(nodeId);
      set({ generatingFlashcardNodeIds: remaining });
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
      const workspaceId = get().activeWorkspaceId;
      if (workspaceId) {
        const workspaceProgress = { ...get().workspaceProgress };
        workspaceProgress[workspaceId] = {
          nodeCount: updatedNodes.length,
          masteredCount: updatedNodes.filter(
            (node) => node.status === "mastered"
          ).length,
        };
        set({ workspaceProgress });
      }
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
    const controller = new AbortController();
    set({
      isLoadingDiagnostic: true,
      diagnosticProgress: null,
      isConfiguringDiagnostic: false,
      diagnosticError: null,
      diagnosticAbortController: controller,
    });
    try {
      const questions = await generateNodeQuiz(node, config, (progress) =>
        set({ diagnosticProgress: progress }),
        controller.signal
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
      if (controller.signal.aborted) {
        set({
          diagnosticError: null,
          isConfiguringDiagnostic: true,
        });
        get().showToast("Quiz generation stopped.");
      } else {
        set({
          diagnosticError:
            err instanceof Error ? err.message : String(err),
          isConfiguringDiagnostic: true,
        });
      }
    } finally {
      set({
        isLoadingDiagnostic: false,
        diagnosticProgress: null,
        diagnosticAbortController: null,
      });
    }
  },

  cancelDiagnosticGeneration: () =>
    get().diagnosticAbortController?.abort(),

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
        if (areFlashcardsEnabled()) {
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
    if (!areFlashcardsEnabled()) {
      throw new Error("Enable the Flashcards plugin to review cards.");
    }
    const updated = scheduleNextReview(card, grade);
    await updateFlashcardSchedule(updated);

    const completedToday = recordCompletedReview();
    const wsId = get().activeWorkspaceId;
    if (!wsId) {
      set({ dueCards: get().dueCards.filter((c) => c.id !== card.id) });
      return;
    }

    try {
      const dueCards = await getDueFlashcards(wsId);
      const { preferences } = get();
      const remaining =
        preferences.dailyReviewLimit === 0
          ? dueCards.length
          : Math.max(0, preferences.dailyReviewLimit - completedToday);
      set({ dueCards: dueCards.slice(0, remaining) });
    } catch (error) {
      set({ dueCards: get().dueCards.filter((item) => item.id !== card.id) });
      get().showToast(
        `Review saved, but the queue could not be refreshed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  },

  loadWorkspaceFlashcards: async (workspaceId) => {
    if (!areFlashcardsEnabled()) {
      throw new Error("Enable the Flashcards plugin to manage cards.");
    }
    return getWorkspaceFlashcards(workspaceId);
  },

  createFlashcard: async (nodeId, front, back) => {
    if (!areFlashcardsEnabled()) {
      throw new Error("Enable the Flashcards plugin to add cards.");
    }
    const node = get().nodes.find((item) => item.id === nodeId);
    if (!node || node.workspace_id !== get().activeWorkspaceId) {
      throw new Error("Choose a lesson in the active workspace.");
    }

    const card = {
      id: crypto.randomUUID(),
      node_id: nodeId,
      front: front.trim(),
      back: back.trim(),
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      next_review_at: Date.now(),
    };
    await insertFlashcard(card);
    const workspaceCard = { ...card, node_title: node.title };
    const flashcardCounts = new Map(get().flashcardCounts);
    const nodeFlashcardCount = flashcardCounts.get(nodeId);
    if (nodeFlashcardCount !== undefined) {
      flashcardCounts.set(nodeId, nodeFlashcardCount + 1);
    }
    const dueCards = [...get().dueCards, workspaceCard].sort(
      (a, b) => a.next_review_at - b.next_review_at
    );
    const remainingReviews =
      get().preferences.dailyReviewLimit === 0
        ? dueCards.length
        : Math.max(
            0,
            get().preferences.dailyReviewLimit - getReviewsCompletedToday()
          );
    set({
      flashcardCounts,
      dueCards: dueCards.slice(0, remainingReviews),
    });
    return workspaceCard;
  },

  editFlashcard: async (card, front, back) => {
    if (!areFlashcardsEnabled()) {
      throw new Error("Enable the Flashcards plugin to edit cards.");
    }
    const node = get().nodes.find(
      (item) =>
        item.id === card.node_id &&
        item.workspace_id === get().activeWorkspaceId
    );
    if (!node) {
      throw new Error("This flashcard is no longer in the active workspace.");
    }

    const updatedCard = { ...card, front: front.trim(), back: back.trim() };
    await updateFlashcardContent(
      card.id,
      card.node_id,
      updatedCard.front,
      updatedCard.back
    );
    if (get().dueCards.some((item) => item.id === card.id)) {
      set({
        dueCards: get().dueCards.map((card) =>
          card.id === updatedCard.id
            ? { ...card, front: updatedCard.front, back: updatedCard.back }
            : card
        ),
      });
    }
    return updatedCard;
  },

  removeFlashcard: async (card) => {
    if (!areFlashcardsEnabled()) {
      throw new Error("Enable the Flashcards plugin to remove cards.");
    }
    await deleteFlashcardRecord(card.id);
    set({ dueCards: get().dueCards.filter((item) => item.id !== card.id) });
    const flashcardCounts = new Map(get().flashcardCounts);
    const nodeFlashcardCount = flashcardCounts.get(card.node_id);
    if (nodeFlashcardCount !== undefined) {
      flashcardCounts.set(
        card.node_id,
        Math.max(0, nodeFlashcardCount - 1)
      );
    }
    set({ flashcardCounts });
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