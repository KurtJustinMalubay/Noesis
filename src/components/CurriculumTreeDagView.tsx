import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FileUp,
  GitBranch,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import type {
  CanvasLayoutMode,
  CurriculumTree,
  CurriculumTreeEdge,
  CurriculumTreeNode,
  GraphEdge,
  GraphNode,
  Workspace,
} from "../types/domain";
import type { CurriculumSourceDocument } from "../ai/curriculumService";
import { generateCurriculumTreeDraft } from "../ai/curriculumService";
import { ingestLocalFilePath } from "../vault/ingestService";
import {
  addCurriculumTreeNode,
  connectCurriculumTreeNodes,
  createCurriculumTree,
  deleteCurriculumTreeNode,
  disconnectCurriculumTreeNodes,
  getCurriculumTreeGraph,
  linkCurriculumTreeWorkspace,
  listArchivedCurriculumTrees,
  listCurriculumTrees,
  restoreCurriculumTreeGraph,
  updateCurriculumTreeLayoutMode,
  updateCurriculumTreeNode,
  updateCurriculumTreeNodePosition,
  updateCurriculumTreeNodePositions,
} from "../db/repositories/curriculumTreeRepo";
import type { WorkspaceProgressSummary } from "../db/repositories/workspaceRepo";
import { computeSugiyamaLayout } from "../engine/sugiyamaLayout";
import { validateAndLayerDag } from "../engine/dagTopology";
import type { UserPreferences } from "../ai/keyStore";
import { summarizeCurriculumProgress } from "../utils/curriculumProgress";
import { DagCanvas } from "./DagCanvas";

interface CurriculumTreeDagViewProps {
  workspaces: Workspace[];
  workspaceProgress: Record<string, WorkspaceProgressSummary>;
  workspaceDeletionRevision: number;
  trees: CurriculumTree[];
  onTreesChange: Dispatch<SetStateAction<CurriculumTree[]>>;
  onArchivedTreesChange: Dispatch<SetStateAction<CurriculumTree[]>>;
  selectedTreeId: string | null;
  onSelectTree: Dispatch<SetStateAction<string | null>>;
  isCreatingTree: boolean;
  onSetCreatingTree: Dispatch<SetStateAction<boolean>>;
  isNativeFullscreen: boolean;
  showDots: boolean;
  edgeRouting: UserPreferences["edgeRouting"];
  nodeDensity: UserPreferences["nodeDensity"];
  onProgressChange: (progress: WorkspaceProgressSummary) => void;
  onSelectWorkspace: (workspaceId: string) => Promise<void>;
  onDeletedWorkspaces: (workspaceIds: string[]) => Promise<void>;
  onCreateWorkspaceForNode: (node: CurriculumTreeNode) => void;
  onToast: (message: string) => void;
}

interface CurriculumGraphSnapshot {
  treeId: string;
  nodes: CurriculumTreeNode[];
  edges: CurriculumTreeEdge[];
  layoutMode: CanvasLayoutMode;
}

function copySnapshot(
  tree: CurriculumTree,
  nodes: CurriculumTreeNode[],
  edges: CurriculumTreeEdge[]
): CurriculumGraphSnapshot {
  return {
    treeId: tree.id,
    nodes: nodes.map((node) => ({ ...node })),
    edges: edges.map((edge) => ({ ...edge })),
    layoutMode: tree.layout_mode,
  };
}

export function CurriculumTreeDagView({
  workspaces,
  workspaceProgress,
  workspaceDeletionRevision,
  trees,
  onTreesChange,
  onArchivedTreesChange,
  selectedTreeId,
  onSelectTree,
  isCreatingTree,
  onSetCreatingTree,
  isNativeFullscreen,
  showDots,
  edgeRouting,
  nodeDensity,
  onProgressChange,
  onSelectWorkspace,
  onCreateWorkspaceForNode,
  onToast,
}: CurriculumTreeDagViewProps) {
  const [nodes, setNodes] = useState<CurriculumTreeNode[]>([]);
  const [edges, setEdges] = useState<CurriculumTreeEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [treePrompt, setTreePrompt] = useState("");
  const [sourceDocument, setSourceDocument] =
    useState<CurriculumSourceDocument | null>(null);
  const [workspaceToLink, setWorkspaceToLink] = useState("");
  const [undoStack, setUndoStack] = useState<CurriculumGraphSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CurriculumGraphSnapshot[]>([]);

  const selectedTree =
    trees.find((tree) => tree.id === selectedTreeId) ?? null;
  const selectedNode =
    nodes.find((node) => node.id === selectedNodeId) ?? null;
  const linkedWorkspaceIds = useMemo(
    () => new Set(nodes.flatMap((node) => node.workspace_id ?? [])),
    [nodes]
  );
  const mapProgress = useMemo(
    () => summarizeCurriculumProgress(linkedWorkspaceIds, workspaceProgress),
    [linkedWorkspaceIds, workspaceProgress]
  );
  const linkableWorkspaces = workspaces.filter(
    (workspace) => !linkedWorkspaceIds.has(workspace.id)
  );

  const graphEdges = useMemo<GraphEdge[]>(
    () =>
      edges.map((edge) => ({
        workspace_id: edge.tree_id,
        source_id: edge.source_id,
        target_id: edge.target_id,
      })),
    [edges]
  );
  const graphNodes = useMemo<GraphNode[]>(() => {
    if (!selectedTree) return [];
    const layered = validateAndLayerDag(
      selectedTree.id,
      nodes.map((node) => ({
        id: node.id,
        title: node.title,
        summary_hint: node.summary_hint,
      })),
      edges.map((edge) => ({
        source_id: edge.source_id,
        target_id: edge.target_id,
      }))
    );
    const prerequisiteCounts = new Map<string, number>();
    for (const edge of edges) {
      prerequisiteCounts.set(
        edge.target_id,
        (prerequisiteCounts.get(edge.target_id) ?? 0) + 1
      );
    }
    const baseNodes = nodes.map((node) => ({
      id: node.id,
      workspace_id: selectedTree.id,
      title: node.title,
      summary_hint: node.summary_hint,
      status: "unlocked" as const,
      mastery_score: 0,
      in_degree_unmastered: 0,
      layer_index: layered.layerByNode.get(node.id) ?? node.layer_index,
      pos_x: node.pos_x,
      pos_y: node.pos_y,
      is_hydrated: node.workspace_id ? 1 : 0,
      lesson_markdown: null,
      mermaid_diagram: null,
      source_citations: null,
      updated_at: selectedTree.updated_at,
      archived_at: null,
    }));
    return selectedTree.layout_mode === "auto"
      ? computeSugiyamaLayout(baseNodes, graphEdges)
      : baseNodes;
  }, [edges, graphEdges, nodes, selectedTree]);

  const refreshGraph = async (treeId: string) => {
    const graph = await getCurriculumTreeGraph(treeId);
    if (!graph) throw new Error("This curriculum map no longer exists.");
    setNodes(graph.nodes);
    setEdges(graph.edges);
    onTreesChange((current) =>
      current.map((tree) => (tree.id === treeId ? graph.tree : tree))
    );
  };

  useEffect(() => {
    let active = true;
    void Promise.all([listCurriculumTrees(), listArchivedCurriculumTrees()])
      .then(([items, archivedItems]) => {
        if (!active) return;
        onTreesChange(items);
        onArchivedTreesChange(archivedItems);
        onSelectTree(items[0]?.id ?? null);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause))
      )
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    onProgressChange(mapProgress);
  }, [mapProgress, onProgressChange]);

  useEffect(() => {
    let active = true;
    setSelectedNodeId(null);
    setUndoStack([]);
    setRedoStack([]);
    if (!selectedTreeId) {
      setNodes([]);
      setEdges([]);
      return;
    }
    void getCurriculumTreeGraph(selectedTreeId)
      .then((graph) => {
        if (!active) return;
        if (!graph) throw new Error("This curriculum map no longer exists.");
        setNodes(graph.nodes);
        setEdges(graph.edges);
        onTreesChange((current) =>
          current.map((tree) =>
            tree.id === selectedTreeId ? graph.tree : tree
          )
        );
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [onTreesChange, selectedTreeId, workspaceDeletionRevision]);

  const snapshotGraph = (): CurriculumGraphSnapshot | null =>
    selectedTree ? copySnapshot(selectedTree, nodes, edges) : null;

  const recordUndo = (snapshot: CurriculumGraphSnapshot | null) => {
    if (!snapshot) return;
    setUndoStack((current) => [...current, snapshot].slice(-10));
    setRedoStack([]);
  };

  const mutateGraph = async (action: () => Promise<void>) => {
    if (!selectedTree || isSaving) {
      throw new Error("Wait for the current curriculum map update to finish.");
    }
    const before = snapshotGraph();
    setIsSaving(true);
    setError(null);
    try {
      await action();
      recordUndo(before);
      await refreshGraph(selectedTree.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      setIsSaving(false);
    }
  };

  const createTree = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const draft = await generateCurriculumTreeDraft(
        treePrompt,
        sourceDocument ?? undefined
      );
      const now = Date.now();
      const tree: CurriculumTree = {
        id: crypto.randomUUID(),
        title: draft.title,
        layout_mode: "auto",
        created_at: now,
        updated_at: now,
        archived_at: null,
      };
      const treeNodes = draft.nodes.map((node) => ({
        ...node,
        tree_id: tree.id,
        workspace_id: null,
        pos_x: 0,
        pos_y: 0,
      }));
      const treeEdges = draft.edges.map((edge) => ({
        ...edge,
        tree_id: tree.id,
      }));
      await createCurriculumTree(tree, treeNodes, treeEdges);
      onTreesChange((current) => [
        tree,
        ...current.filter((item) => item.id !== tree.id),
      ]);
      onSelectTree(tree.id);
      setNodes(treeNodes);
      setEdges(treeEdges);
      onSetCreatingTree(false);
      setTreePrompt("");
      setSourceDocument(null);
      onToast(`Created "${tree.title}" with ${treeNodes.length} subjects.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePickSource = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Course Documents", extensions: ["pdf", "md", "txt"] }],
      });
      if (!path || Array.isArray(path)) return;
      const result = await ingestLocalFilePath(path, null, true);
      if (!result.extractedText?.trim()) {
        throw new Error(
          `No readable text was found in "${result.document.file_name}".`
        );
      }
      setSourceDocument({
        name: result.document.file_name,
        text: result.extractedText,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addNode = async (input: {
    title: string;
    summary: string;
    x: number;
    y: number;
  }): Promise<string> => {
    if (!selectedTree) throw new Error("Select a curriculum map first.");
    const id = crypto.randomUUID();
    const node: CurriculumTreeNode = {
      id,
      tree_id: selectedTree.id,
      workspace_id: null,
      title: input.title,
      summary_hint: input.summary,
      layer_index: 0,
      pos_x: input.x,
      pos_y: input.y,
    };
    await mutateGraph(() => addCurriculumTreeNode(node));
    setSelectedNodeId(id);
    return id;
  };

  const addExistingWorkspace = async (
    workspaceId: string,
    x: number,
    y: number
  ): Promise<string> => {
    if (!selectedTree) throw new Error("Select a curriculum map first.");
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error("The selected workspace is no longer available.");
    if (linkedWorkspaceIds.has(workspaceId)) {
      throw new Error("This workspace is already in the curriculum map.");
    }

    const id = crypto.randomUUID();
    const node: CurriculumTreeNode = {
      id,
      tree_id: selectedTree.id,
      workspace_id: workspace.id,
      title: workspace.title,
      summary_hint: workspace.root_domain,
      layer_index: 0,
      pos_x: x,
      pos_y: y,
    };
    await mutateGraph(() => addCurriculumTreeNode(node));
    setSelectedNodeId(id);
    return id;
  };

  const editNode = async (
    nodeId: string,
    title: string,
    summary: string
  ) => {
    if (!selectedTree) return;
    await mutateGraph(() =>
      updateCurriculumTreeNode(selectedTree.id, nodeId, title, summary)
    );
  };

  const removeNode = async (nodeId: string) => {
    if (!selectedTree) return;
    await mutateGraph(() =>
      deleteCurriculumTreeNode(selectedTree.id, nodeId)
    );
    setSelectedNodeId((current) => (current === nodeId ? null : current));
  };

  const moveNode = async (nodeId: string, x: number, y: number) => {
    if (!selectedTree) return;
    await mutateGraph(() =>
      updateCurriculumTreeNodePosition(selectedTree.id, nodeId, x, y)
    );
  };

  const setLayoutMode = async (mode: CanvasLayoutMode) => {
    if (!selectedTree || selectedTree.layout_mode === mode) return;
    await mutateGraph(async () => {
      if (mode === "free") {
        await updateCurriculumTreeNodePositions(
          selectedTree.id,
          graphNodes.map(({ id, pos_x, pos_y }) => ({ id, pos_x, pos_y }))
        );
      }
      await updateCurriculumTreeLayoutMode(selectedTree.id, mode);
    });
  };

  const realignGrid = async () => {
    if (!selectedTree) return;
    await mutateGraph(() =>
      updateCurriculumTreeNodePositions(
        selectedTree.id,
        graphNodes.map((node) => ({
          id: node.id,
          pos_x: Math.round(node.pos_x / 16) * 16,
          pos_y: Math.round(node.pos_y / 16) * 16,
        }))
      )
    );
  };

  const connectNodes = async (sourceId: string, targetId: string) => {
    if (!selectedTree) return;
    await mutateGraph(() =>
      connectCurriculumTreeNodes(selectedTree.id, sourceId, targetId)
    );
  };

  const disconnectNodes = async (sourceId: string, targetId: string) => {
    if (!selectedTree) return;
    await mutateGraph(() =>
      disconnectCurriculumTreeNodes(selectedTree.id, sourceId, targetId)
    );
  };

  const linkSelectedWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !selectedTree ||
      !selectedNode ||
      !workspaceToLink ||
      isSaving
    ) {
      return;
    }
    await mutateGraph(() =>
      linkCurriculumTreeWorkspace(
        selectedTree.id,
        selectedNode.id,
        workspaceToLink
      )
    );
    setWorkspaceToLink("");
  };

  const restoreSnapshot = async (
    target: CurriculumGraphSnapshot,
    current: CurriculumGraphSnapshot
  ) => {
    await restoreCurriculumTreeGraph(
      target.treeId,
      target.nodes,
      target.edges,
      target.layoutMode
    );
    setNodes(target.nodes);
    setEdges(target.edges);
    onTreesChange((items) =>
      items.map((tree) =>
        tree.id === target.treeId
          ? { ...tree, layout_mode: target.layoutMode, updated_at: Date.now() }
          : tree
      )
    );
    setUndoStack((items) => items.slice(0, -1));
    setRedoStack((items) => [...items, current].slice(-10));
  };

  const undo = async () => {
    if (!selectedTree || isSaving || undoStack.length === 0) return;
    const target = undoStack[undoStack.length - 1];
    const current = copySnapshot(selectedTree, nodes, edges);
    setIsSaving(true);
    setError(null);
    try {
      await restoreSnapshot(target, current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  };

  const redo = async () => {
    if (!selectedTree || isSaving || redoStack.length === 0) return;
    const target = redoStack[redoStack.length - 1];
    const current = copySnapshot(selectedTree, nodes, edges);
    setIsSaving(true);
    setError(null);
    try {
      await restoreCurriculumTreeGraph(
        target.treeId,
        target.nodes,
        target.edges,
        target.layoutMode
      );
      setNodes(target.nodes);
      setEdges(target.edges);
      onTreesChange((items) =>
        items.map((tree) =>
          tree.id === target.treeId
            ? { ...tree, layout_mode: target.layoutMode, updated_at: Date.now() }
            : tree
        )
      );
      setRedoStack((items) => items.slice(0, -1));
      setUndoStack((items) => [...items, current].slice(-10));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted)]">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
        Loading curriculum maps…
      </div>
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-canvas)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {error && (
            <p
              role="alert"
              className="mx-5 mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800"
            >
              {error}
            </p>
          )}

          {isCreatingTree ? (
            <form
              onSubmit={(event) => void createTree(event)}
              className="m-auto w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-[var(--color-accent-soft)] p-2 text-[var(--color-accent)]">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold">Generate a curriculum map</h3>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--color-muted)]">
                    Describe the program scope or add a syllabus. AI drafts subjects and supported prerequisite connections.
                  </p>
                </div>
              </div>
              <textarea
                value={treePrompt}
                onChange={(event) => setTreePrompt(event.target.value)}
                rows={3}
                placeholder="e.g. Computer Science, third year, first semester"
                className="mt-4 w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-canvas)] p-3 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => void handlePickSource()}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold hover:bg-[var(--color-hover)]"
                >
                  <FileUp className="h-3.5 w-3.5" />
                  Add syllabus
                </button>
                {sourceDocument && (
                  <span className="max-w-[240px] truncate text-[11px] text-[var(--color-muted)]">
                    {sourceDocument.name}
                  </span>
                )}
              </div>
              {isGenerating && (
                <p role="status" className="mt-4 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  Generating in the background. You can switch views; this progress will remain here.
                </p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={() => onSetCreatingTree(false)}
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--color-muted)] hover:bg-[var(--color-hover)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isGenerating || (!treePrompt.trim() && !sourceDocument)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent-button)] px-3.5 py-2 text-xs font-semibold text-[var(--color-accent-foreground)] disabled:opacity-50"
                >
                  {isGenerating ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {isGenerating ? "Generating…" : "Generate map"}
                </button>
              </div>
            </form>
          ) : !selectedTree ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <GitBranch className="h-9 w-9 text-[var(--color-muted)]" />
              <h3 className="mt-3 text-base font-semibold">No curriculum maps yet</h3>
              <p className="mt-1 max-w-md text-xs leading-5 text-[var(--color-muted)]">
                Create a curriculum map for a semester, year, or full program. Add subjects, connect prerequisites, and link each subject to its own workspace.
              </p>
              <button
                type="button"
                onClick={() => onSetCreatingTree(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent-button)] px-3.5 py-2.5 text-xs font-semibold text-[var(--color-accent-foreground)]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate a map
              </button>
            </div>
          ) : (
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <DagCanvas
                    nodeKind="subject"
                    showArchiveControls={false}
                    existingWorkspaces={linkableWorkspaces}
                    onAddExistingWorkspace={addExistingWorkspace}
                    workspaceId={selectedTree.id}
                    isNativeFullscreen={isNativeFullscreen}
                    nodes={graphNodes}
                    edges={graphEdges}
                    layoutMode={selectedTree.layout_mode}
                    selectedNodeId={selectedNodeId}
                    showDots={showDots}
                    edgeRouting={edgeRouting}
                    nodeDensity={nodeDensity}
                    quizNodeIds={new Set()}
                    canUndo={undoStack.length > 0 && !isSaving}
                    canRedo={redoStack.length > 0 && !isSaving}
                    onSelectNode={(nodeId) => {
                      setSelectedNodeId(nodeId);
                      const clicked = nodes.find((node) => node.id === nodeId);
                      if (clicked && !clicked.workspace_id) {
                        onCreateWorkspaceForNode(clicked);
                      }
                    }}
                    onDeselectNode={() => setSelectedNodeId(null)}
                    onSetLayoutMode={setLayoutMode}
                    onMoveNode={moveNode}
                    onRealignGrid={realignGrid}
                    onAddNode={addNode}
                    onEditNode={editNode}
                    onArchiveNode={removeNode}
                    onConnectNodes={connectNodes}
                    onDisconnectNodes={disconnectNodes}
                    onToast={(message) => {
                      if (message) onToast(message);
                    }}
                    onUndo={undo}
                    onRedo={redo}
              />

              {selectedNode && (
                <section
                  data-canvas-toolbar
                  aria-label="Selected curriculum subject"
                  className="absolute bottom-4 right-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap items-center justify-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)]/95 p-2 shadow-[0_5px_18px_rgba(35,51,60,0.12)] backdrop-blur"
                >
                  <span className="max-w-40 truncate px-2 text-[11px] font-semibold text-[var(--color-ink)]">
                    {selectedNode.title}
                  </span>
                  {selectedNode.workspace_id ? (
                    <button
                      type="button"
                      onClick={() =>
                        void onSelectWorkspace(selectedNode.workspace_id!).catch(
                          (cause: unknown) =>
                            onToast(
                              cause instanceof Error
                                ? cause.message
                                : String(cause)
                            )
                        )
                      }
                      className="rounded-lg bg-[var(--color-accent-button)] px-3 py-2 text-[10px] font-semibold text-[var(--color-accent-foreground)]"
                    >
                      Open workspace
                    </button>
                  ) : (
                    <>
                      <form
                        onSubmit={(event) => void linkSelectedWorkspace(event)}
                        className="flex items-center gap-2"
                      >
                        <select
                          value={workspaceToLink}
                          onChange={(event) =>
                            setWorkspaceToLink(event.target.value)
                          }
                          aria-label="Workspace to link to this subject"
                          className="max-w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-2.5 py-2 text-[10px]"
                        >
                          <option value="">Link existing workspace…</option>
                          {linkableWorkspaces.map((workspace) => (
                            <option key={workspace.id} value={workspace.id}>
                              {workspace.title}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          disabled={isSaving || !workspaceToLink}
                          className="rounded-lg border border-[var(--color-border)] px-2.5 py-2 text-[10px] font-semibold disabled:opacity-40"
                        >
                          Link
                        </button>
                      </form>
                      <button
                        type="button"
                        onClick={() => onCreateWorkspaceForNode(selectedNode)}
                        className="rounded-lg bg-[var(--color-accent-button)] px-3 py-2 text-[10px] font-semibold text-[var(--color-accent-foreground)]"
                      >
                        Create workspace
                      </button>
                    </>
                  )}
                </section>
              )}
            </div>
          )}
      </div>
    </section>
  );
}
