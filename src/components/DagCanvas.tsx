import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Compass,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  PlayCircle,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  CanvasLayoutMode,
  GraphEdge,
  GraphNode,
} from "../types/domain";
import { canReach } from "../engine/dagTopology";
import { DEFAULT_LAYOUT_CONFIG } from "../engine/sugiyamaLayout";
import type { UserPreferences } from "../ai/keyStore";
import { stripMathMarkup } from "./ui/normalizeMathMarkdown";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { ArchivedConceptsDialog } from "./ArchivedConceptsDialog";

interface DagCanvasProps {
  workspaceId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layoutMode: CanvasLayoutMode;
  selectedNodeId: string | null;
  showDots: boolean;
  edgeRouting: UserPreferences["edgeRouting"];
  nodeDensity: UserPreferences["nodeDensity"];
  quizNodeIds: Set<string>;
  onSelectNode: (nodeId: string) => void;
  onSetLayoutMode: (mode: CanvasLayoutMode) => Promise<void>;
  onMoveNode: (nodeId: string, x: number, y: number) => Promise<void>;
  onRealignGrid: () => Promise<void>;
  onAddNode: (input: {
    title: string;
    summary: string;
    x: number;
    y: number;
  }) => Promise<string>;
  onEditNode: (
    nodeId: string,
    title: string,
    summary: string
  ) => Promise<void>;
  onArchiveNode: (nodeId: string) => Promise<void>;
  onRestoreArchivedNode: (
    workspaceId: string,
    nodeId: string
  ) => Promise<void>;
  onPermanentlyDeleteArchivedNode: (
    workspaceId: string,
    nodeId: string
  ) => Promise<void>;
  onConnectNodes: (sourceId: string, targetId: string) => Promise<void>;
  onDisconnectNodes: (sourceId: string, targetId: string) => Promise<void>;
  onToast: (message: string | null) => void;
}

interface NodeDragState {
  nodeId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
}

interface ConnectionDragState {
  sourceId: string;
  pointerId: number;
  x: number;
  y: number;
  targetId: string | null;
  targetIsValid: boolean;
}

interface EditorState {
  mode: "add" | "edit";
  nodeId: string | null;
  left: number;
  top: number;
  worldX: number;
  worldY: number;
}

const EDGE_MIDPOINT_STAGGER = 12;
const NODE_DRAG_THRESHOLD = 5;

export function DagCanvas({
  workspaceId,
  nodes,
  edges,
  layoutMode,
  selectedNodeId,
  showDots,
  edgeRouting,
  nodeDensity,
  quizNodeIds,
  onSelectNode,
  onSetLayoutMode,
  onMoveNode,
  onRealignGrid,
  onAddNode,
  onEditNode,
  onArchiveNode,
  onRestoreArchivedNode,
  onPermanentlyDeleteArchivedNode,
  onConnectNodes,
  onDisconnectNodes,
  onToast,
}: DagCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphTrackRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 450, y: 80 });
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [cameraDuration, setCameraDuration] = useState<number | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [positionOverrides, setPositionOverrides] = useState(
    () => new Map<string, { x: number; y: number }>()
  );
  const [connection, setConnection] = useState<ConnectionDragState | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);
  const [openMenuNodeId, setOpenMenuNodeId] = useState<string | null>(null);
  const [confirmDeleteNode, setConfirmDeleteNode] = useState<GraphNode | null>(
    null
  );
  const [showArchivedConcepts, setShowArchivedConcepts] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorSummary, setEditorSummary] = useState("");
  const [isSavingEditor, setIsSavingEditor] = useState(false);
  const [isAnimatingLayout, setIsAnimatingLayout] = useState(false);
  const [invalidTargetId, setInvalidTargetId] = useState<string | null>(null);
  const dragOrigin = useRef({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const scaleRef = useRef(scale);
  const cameraTimer = useRef<number | null>(null);
  const layoutTimer = useRef<number | null>(null);
  const invalidTargetTimer = useRef<number | null>(null);
  const nodeDragRef = useRef<NodeDragState | null>(null);
  const connectionRef = useRef<ConnectionDragState | null>(null);
  const suppressClickNodeId = useRef<string | null>(null);
  const { nodeWidth, nodeHeight, verticalGap } = DEFAULT_LAYOUT_CONFIG;
  const displayNodes = useMemo(
    () =>
      nodes.map((node) => {
        const override = positionOverrides.get(node.id);
        return override
          ? { ...node, pos_x: override.x, pos_y: override.y }
          : node;
      }),
    [nodes, positionOverrides]
  );
  const layoutKey = useMemo(
    () =>
      nodes
        .map((node) => `${node.id}:${node.pos_x}:${node.pos_y}`)
        .join(":"),
    [nodes]
  );
  const lastViewRef = useRef<{
    layoutKey: string;
    layoutMode: CanvasLayoutMode | null;
  }>({ layoutKey: "", layoutMode: null });
  const graphIndexes = useMemo(() => {
    const nodeMap = new Map(displayNodes.map((node) => [node.id, node]));
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();
    const prerequisiteCounts = new Map<string, number>();
    const layerSet = new Set<number>();
    let minX = displayNodes.length ? Number.POSITIVE_INFINITY : 0;
    let minY = displayNodes.length ? Number.POSITIVE_INFINITY : 0;
    let maxX = displayNodes.length ? Number.NEGATIVE_INFINITY : 0;
    let maxY = displayNodes.length ? Number.NEGATIVE_INFINITY : 0;

    for (const node of displayNodes) {
      parents.set(node.id, []);
      children.set(node.id, []);
      layerSet.add(node.layer_index);
      minX = Math.min(minX, node.pos_x);
      minY = Math.min(minY, node.pos_y);
      maxX = Math.max(maxX, node.pos_x + nodeWidth);
      maxY = Math.max(maxY, node.pos_y + nodeHeight);
    }
    for (const edge of edges) {
      parents.get(edge.target_id)?.push(edge.source_id);
      children.get(edge.source_id)?.push(edge.target_id);
      prerequisiteCounts.set(
        edge.target_id,
        (prerequisiteCounts.get(edge.target_id) ?? 0) + 1
      );
    }

    return {
      nodeMap,
      parents,
      children,
      prerequisiteCounts,
      layerIndices: Array.from(layerSet).sort((a, b) => a - b),
      minX,
      minY,
      maxX,
      maxY,
    };
  }, [displayNodes, edges, nodeWidth, nodeHeight]);
  const focusNodeId = hoveredNodeId ?? selectedNodeId;
  const { ancestors, lineageIds } = useMemo(() => {
    const ancestors = new Set<string>();
    const descendants = new Set<string>();
    const lineageIds = new Set<string>();
    if (!focusNodeId) return { ancestors, descendants, lineageIds };

    const collect = (
      start: string,
      adjacency: Map<string, string[]>,
      found: Set<string>
    ) => {
      const queue = [...(adjacency.get(start) ?? [])];
      for (let head = 0; head < queue.length; head++) {
        const id = queue[head];
        if (found.has(id)) continue;
        found.add(id);
        for (const adjacentId of adjacency.get(id) ?? []) {
          queue.push(adjacentId);
        }
      }
    };
    collect(focusNodeId, graphIndexes.parents, ancestors);
    collect(focusNodeId, graphIndexes.children, descendants);
    lineageIds.add(focusNodeId);
    for (const id of ancestors) lineageIds.add(id);
    for (const id of descendants) lineageIds.add(id);
    return { ancestors, descendants, lineageIds };
  }, [focusNodeId, graphIndexes]);
  const validTargetIds = useMemo(() => {
    const sourceId = connection?.sourceId;
    if (!sourceId) return new Set<string>();
    const parents = new Map<string, string[]>();
    for (const edge of edges) {
      let incoming = parents.get(edge.target_id);
      if (!incoming) {
        incoming = [];
        parents.set(edge.target_id, incoming);
      }
      incoming.push(edge.source_id);
    }
    const nodesThatReachSource = new Set<string>([sourceId]);
    const stack = [sourceId];
    while (stack.length > 0) {
      for (const parent of parents.get(stack.pop()!) ?? []) {
        if (nodesThatReachSource.has(parent)) continue;
        nodesThatReachSource.add(parent);
        stack.push(parent);
      }
    }
    return new Set(
      displayNodes
        .filter(
          (node) =>
            node.id !== sourceId &&
            !nodesThatReachSource.has(node.id) &&
            !edges.some(
              (edge) =>
                edge.source_id === sourceId && edge.target_id === node.id
            )
        )
        .map((node) => node.id)
    );
  }, [connection?.sourceId, displayNodes, edges]);

  const showError = (error: unknown) => {
    onToast(error instanceof Error ? error.message : String(error));
  };

  const runCanvasAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      showError(error);
    }
  };

  const deleteNode = async (node: GraphNode) => {
    await onArchiveNode(node.id);
    setOpenMenuNodeId(null);
  };

  const animateCamera = (duration: number) => {
    if (cameraTimer.current !== null) {
      window.clearTimeout(cameraTimer.current);
    }
    setCameraDuration(duration);
    cameraTimer.current = window.setTimeout(() => {
      setCameraDuration(null);
      cameraTimer.current = null;
    }, duration);
  };

  const stopCameraAnimation = () => {
    if (cameraTimer.current !== null) {
      window.clearTimeout(cameraTimer.current);
      cameraTimer.current = null;
    }
    setCameraDuration(null);
  };

  const fitGraph = () => {
    animateCamera(300);
    const rect = containerRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 900;
    const height = rect?.height ?? 650;
    if (nodes.length === 0) {
      const nextPan = { x: Math.round(width / 2), y: 72 };
      panRef.current = nextPan;
      scaleRef.current = 1;
      setPan(nextPan);
      setScale(1);
      return;
    }
    const graphWidth = graphIndexes.maxX - graphIndexes.minX;
    const graphHeight = graphIndexes.maxY - graphIndexes.minY;
    const nextScale = Math.min(
      1.35,
      (width - 100) / graphWidth,
      (height - 140) / graphHeight
    );
    const boundedScale = Math.max(0.35, nextScale);
    const nextPan = {
      x:
        (width - graphWidth * boundedScale) / 2 -
        graphIndexes.minX * boundedScale,
      y: 58 - graphIndexes.minY * boundedScale,
    };
    panRef.current = nextPan;
    scaleRef.current = boundedScale;
    setScale(boundedScale);
    setPan(nextPan);
  };

  useEffect(() => {
    const shouldFit =
      lastViewRef.current.layoutMode === null ||
      lastViewRef.current.layoutMode !== layoutMode ||
      (layoutMode === "auto" &&
        lastViewRef.current.layoutKey !== layoutKey);
    lastViewRef.current = { layoutKey, layoutMode };
    if (shouldFit) fitGraph();
  }, [layoutKey, layoutMode]);

  useEffect(() => {
    setShowArchivedConcepts(false);
  }, [workspaceId]);

  useEffect(
    () => () => {
      if (cameraTimer.current !== null) window.clearTimeout(cameraTimer.current);
      if (layoutTimer.current !== null) window.clearTimeout(layoutTimer.current);
      if (invalidTargetTimer.current !== null) {
        window.clearTimeout(invalidTargetTimer.current);
      }
    },
    []
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target;
    if (
      target instanceof Element &&
      target.closest(
        "[data-dag-node], [data-dag-edge], button, [data-canvas-popover]"
      )
    ) {
      return;
    }
    stopCameraAnimation();
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOrigin.current = {
      x: e.clientX - panRef.current.x,
      y: e.clientY - panRef.current.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const nextPan = {
      x: e.clientX - dragOrigin.current.x,
      y: e.clientY - dragOrigin.current.y,
    };
    panRef.current = nextPan;
    if (graphTrackRef.current) {
      graphTrackRef.current.style.transform =
        `translate3d(${nextPan.x}px, ${nextPan.y}px, 0) scale(${scaleRef.current})`;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setPan(panRef.current);
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (
      e.target instanceof Element &&
      e.target.closest("[data-canvas-popover], [data-canvas-toolbar]")
    ) {
      return;
    }
    e.preventDefault();
    animateCamera(120);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextScale = Math.min(
      1.6,
      Math.max(
        0.35,
        Number((scaleRef.current + (e.deltaY < 0 ? 0.08 : -0.08)).toFixed(2))
      )
    );
    const ratio = nextScale / scaleRef.current;
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const nextPan = {
      x: cursorX - (cursorX - panRef.current.x) * ratio,
      y: cursorY - (cursorY - panRef.current.y) * ratio,
    };
    panRef.current = nextPan;
    scaleRef.current = nextScale;
    setScale(nextScale);
    setPan(nextPan);
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - panRef.current.x) / scaleRef.current,
      y: (clientY - rect.top - panRef.current.y) / scaleRef.current,
    };
  };

  const openAddEditor = (screenX: number, screenY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 900;
    const height = rect?.height ?? 650;
    const left = Math.max(16, Math.min(screenX, width - 336));
    const top = Math.max(64, Math.min(screenY, height - 250));
    const world = screenToWorld(
      (rect?.left ?? 0) + left + 150,
      (rect?.top ?? 0) + top + 90
    );
    setOpenMenuNodeId(null);
    setEditorTitle("");
    setEditorSummary("");
    setEditor({
      mode: "add",
      nodeId: null,
      left,
      top,
      worldX: world.x - nodeWidth / 2,
      worldY: world.y - nodeHeight / 2,
    });
  };

  const openEditEditor = (node: GraphNode) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 900;
    setOpenMenuNodeId(null);
    setEditorTitle(node.title);
    setEditorSummary(node.summary_hint);
    setEditor({
      mode: "edit",
      nodeId: node.id,
      left: Math.max(16, Math.min(width / 2 - 150, width - 336)),
      top: 76,
      worldX: node.pos_x,
      worldY: node.pos_y,
    });
  };

  const handleEditorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingEditor) return;
    if (!editorTitle.trim()) {
      onToast("Concept title is required.");
      return;
    }
    setIsSavingEditor(true);
    try {
      if (editor?.mode === "add") {
        await onAddNode({
          title: editorTitle,
          summary: editorSummary,
          x: editor.worldX,
          y: editor.worldY,
        });
      } else if (editor?.nodeId) {
        await onEditNode(editor.nodeId, editorTitle, editorSummary);
      }
      setEditor(null);
    } catch (error) {
      showError(error);
    } finally {
      setIsSavingEditor(false);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const target = e.target;
    if (
      target instanceof Element &&
      target.closest("[data-dag-node], button, [data-canvas-popover]")
    ) {
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    openAddEditor(e.clientX - rect.left - 150, e.clientY - rect.top - 24);
  };

  const handleNodePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    node: GraphNode
  ) => {
    e.stopPropagation();
    if (layoutMode !== "free" || e.button !== 0) return;
    const drag: NodeDragState = {
      nodeId: node.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: node.pos_x,
      startY: node.pos_y,
      x: node.pos_x,
      y: node.pos_y,
      dragging: false,
    };
    nodeDragRef.current = drag;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleNodePointerMove = (
    e: React.PointerEvent<HTMLButtonElement>,
    nodeId: string
  ) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.nodeId !== nodeId || drag.pointerId !== e.pointerId) return;
    const deltaX = (e.clientX - drag.startClientX) / scaleRef.current;
    const deltaY = (e.clientY - drag.startClientY) / scaleRef.current;
    if (
      !drag.dragging &&
      Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) <
        NODE_DRAG_THRESHOLD
    ) {
      return;
    }
    drag.dragging = true;
    e.preventDefault();
    let x = drag.startX + deltaX;
    let y = drag.startY + deltaY;
    if (e.shiftKey) {
      x = Math.round(x / 16) * 16;
      y = Math.round(y / 16) * 16;
    }
    drag.x = x;
    drag.y = y;
    setPositionOverrides((current) => {
      const next = new Map(current);
      next.set(nodeId, { x, y });
      return next;
    });
  };

  const clearPositionOverride = (nodeId: string) => {
    setPositionOverrides((current) => {
      if (!current.has(nodeId)) return current;
      const next = new Map(current);
      next.delete(nodeId);
      return next;
    });
  };

  const handleNodePointerUp = (
    e: React.PointerEvent<HTMLButtonElement>,
    nodeId: string
  ) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.nodeId !== nodeId || drag.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    nodeDragRef.current = null;
    if (!drag.dragging) return;
    suppressClickNodeId.current = nodeId;
    void onMoveNode(nodeId, drag.x, drag.y)
      .catch(showError)
      .finally(() => clearPositionOverride(nodeId));
  };

  const handleNodePointerCancel = (
    e: React.PointerEvent<HTMLButtonElement>,
    nodeId: string
  ) => {
    const drag = nodeDragRef.current;
    if (!drag || drag.nodeId !== nodeId || drag.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    nodeDragRef.current = null;
    if (drag.dragging) clearPositionOverride(nodeId);
  };

  const findInputPortTarget = (
    x: number,
    y: number,
    sourceId: string
  ): { nodeId: string; valid: boolean } | null => {
    let closest: { nodeId: string; distance: number } | null = null;
    for (const node of displayNodes) {
      const portX = node.pos_x + nodeWidth / 2;
      const portY = node.pos_y;
      const distance = Math.hypot(portX - x, portY - y);
      if (
        distance <= 20 &&
        (!closest || distance < closest.distance)
      ) {
        closest = { nodeId: node.id, distance };
      }
    }
    if (!closest) return null;
    const targetId = closest.nodeId;
    const duplicate = edges.some(
      (edge) => edge.source_id === sourceId && edge.target_id === targetId
    );
    return {
      nodeId: targetId,
      valid:
        targetId !== sourceId &&
        !duplicate &&
        !canReach(edges, targetId, sourceId),
    };
  };

  const handleOutputPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    node: GraphNode
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const world = screenToWorld(e.clientX, e.clientY);
    const next: ConnectionDragState = {
      sourceId: node.id,
      pointerId: e.pointerId,
      x: world.x,
      y: world.y,
      targetId: null,
      targetIsValid: false,
    };
    connectionRef.current = next;
    setConnection(next);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleOutputPointerMove = (
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    const current = connectionRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const world = screenToWorld(e.clientX, e.clientY);
    const target = findInputPortTarget(world.x, world.y, current.sourceId);
    const next = {
      ...current,
      x: world.x,
      y: world.y,
      targetId: target?.nodeId ?? null,
      targetIsValid: target?.valid ?? false,
    };
    connectionRef.current = next;
    setConnection(next);
  };

  const flashInvalidTarget = (targetId: string) => {
    setInvalidTargetId(targetId);
    if (invalidTargetTimer.current !== null) {
      window.clearTimeout(invalidTargetTimer.current);
    }
    invalidTargetTimer.current = window.setTimeout(() => {
      setInvalidTargetId(null);
      invalidTargetTimer.current = null;
    }, 700);
  };

  const handleOutputPointerUp = (
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    const current = connectionRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    connectionRef.current = null;
    setConnection(null);
    if (!current.targetId) return;

    if (current.targetId === current.sourceId) {
      onToast("Cannot connect a concept to itself.");
      flashInvalidTarget(current.targetId);
      return;
    }
    if (
      edges.some(
        (edge) =>
          edge.source_id === current.sourceId &&
          edge.target_id === current.targetId
      )
    ) {
      onToast("These concepts are already connected.");
      return;
    }
    if (canReach(edges, current.targetId, current.sourceId)) {
      onToast("Cannot connect: circular prerequisite detected.");
      flashInvalidTarget(current.targetId);
      return;
    }
    void runCanvasAction(() =>
      onConnectNodes(current.sourceId, current.targetId!)
    );
  };

  const handleOutputPointerCancel = (
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    const current = connectionRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    connectionRef.current = null;
    setConnection(null);
  };

  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (confirmDeleteNode) {
      if (e.key === "Escape") setConfirmDeleteNode(null);
      return;
    }
    if (!selectedEdge || (e.key !== "Delete" && e.key !== "Backspace")) return;
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
    ) {
      return;
    }
    e.preventDefault();
    const edge = selectedEdge;
    setSelectedEdge(null);
    void runCanvasAction(() =>
      onDisconnectNodes(edge.sourceId, edge.targetId)
    );
  };

  const startLayoutAnimation = () => {
    setIsAnimatingLayout(true);
    if (layoutTimer.current !== null) {
      window.clearTimeout(layoutTimer.current);
    }
    layoutTimer.current = window.setTimeout(() => {
      setIsAnimatingLayout(false);
      layoutTimer.current = null;
    }, 400);
  };

  const resetToAutoLayout = async () => {
    startLayoutAnimation();
    try {
      await onSetLayoutMode("auto");
    } catch (error) {
      showError(error);
      setIsAnimatingLayout(false);
    }
  };

  const realignGrid = async () => {
    startLayoutAnimation();
    try {
      await onRealignGrid();
    } catch (error) {
      showError(error);
      setIsAnimatingLayout(false);
    }
  };

  const openMenu = (nodeId: string) => {
    setOpenMenuNodeId((current) => (current === nodeId ? null : nodeId));
  };

  const layerStep = nodeHeight + verticalGap;
  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setHoveredNodeId(null)}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleCanvasKeyDown}
      className={`relative h-full w-full overflow-hidden bg-[var(--color-canvas)] select-none outline-none ${
        isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
      style={
        showDots
          ? {
              backgroundImage:
                "radial-gradient(circle at 1px 1px, var(--color-canvas-dot) 1px, transparent 0)",
              backgroundSize: "24px 24px",
            }
          : undefined
      }
    >
      <div
        ref={graphTrackRef}
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
          transformOrigin: "0 0",
          transition:
            cameraDuration !== null && !isDragging
              ? `transform ${cameraDuration}ms var(--ease-spring)`
              : "none",
        }}
        className="pointer-events-none absolute left-0 top-0"
      >
        {layoutMode === "auto" &&
          graphIndexes.layerIndices.map((layer) => (
            <div
              key={layer}
              className="absolute rounded-2xl border border-[#e5e3dd]/80 bg-white/25"
              style={{
                left: graphIndexes.minX - 40,
                top: layer * layerStep - 30,
                width: graphIndexes.maxX - graphIndexes.minX + 80,
                height: nodeHeight + 60,
              }}
            >
              <span className="absolute -top-3 left-4 rounded-full border border-[#e5e3dd] bg-[#f5f4f0] px-2.5 py-1 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500">
                Layer {layer + 1}
              </span>
            </div>
          ))}

        <svg
          width="1"
          height="1"
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="arrow-mastered"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-success)" />
            </marker>
            <marker
              id="arrow-locked"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-edge-muted)" />
            </marker>
            <marker
              id="arrow-unlocked"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-edge-active)" />
            </marker>
            <marker
              id="arrow-in-progress"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path
                d="M 0 1 L 10 5 L 0 9 z"
                fill="var(--node-progress-accent)"
              />
            </marker>
          </defs>

          {edges.map((edge, edgeIndex) => {
            const src = graphIndexes.nodeMap.get(edge.source_id);
            const tgt = graphIndexes.nodeMap.get(edge.target_id);
            if (!src || !tgt) return null;

            const x1 = src.pos_x + nodeWidth / 2;
            const y1 = src.pos_y + nodeHeight + 4;
            const x2 = tgt.pos_x + nodeWidth / 2;
            const y2 = tgt.pos_y - 4;
            const controlGap = Math.max(28, (y2 - y1) / 2);
            const midY =
              y1 + (y2 - y1) / 2 + ((edgeIndex % 3) - 1) * EDGE_MIDPOINT_STAGGER;
            const isMastered = src.status === "mastered";
            const isLockedPath = tgt.status === "locked";
            const isInProgressPath = src.status === "in_progress";
            const inLineage =
              !focusNodeId ||
              (lineageIds.has(edge.source_id) &&
                lineageIds.has(edge.target_id));
            const isUpstream =
              ancestors.has(edge.source_id) || ancestors.has(edge.target_id);
            const isSelected =
              selectedEdge?.sourceId === edge.source_id &&
              selectedEdge.targetId === edge.target_id;
            const stroke = isSelected
              ? "var(--color-accent)"
              : isMastered
                ? "var(--color-success)"
                : isInProgressPath
                  ? "var(--node-progress-accent)"
                  : isLockedPath
                    ? "var(--color-edge-muted)"
                    : isUpstream
                      ? "var(--color-edge-upstream)"
                      : "var(--color-edge-active)";
            const path =
              edgeRouting === "orthogonal"
                ? `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`
                : `M ${x1} ${y1} C ${x1} ${y1 + controlGap}, ${x2} ${y2 - controlGap}, ${x2} ${y2}`;

            return (
              <path
                key={`${edge.source_id}-${edge.target_id}`}
                data-dag-edge
                d={path}
                fill="none"
                stroke={stroke}
                strokeWidth={isSelected ? 3 : focusNodeId && inLineage ? 2.5 : isMastered ? 2 : 1.5}
                strokeDasharray={isMastered || !isLockedPath ? undefined : "5 5"}
                opacity={inLineage ? 0.82 : 0.12}
                markerEnd={
                  isMastered
                    ? "url(#arrow-mastered)"
                    : isInProgressPath
                      ? "url(#arrow-in-progress)"
                      : isLockedPath
                        ? "url(#arrow-locked)"
                        : "url(#arrow-unlocked)"
                }
                className="pointer-events-auto cursor-pointer transition-opacity"
                style={{ pointerEvents: "stroke" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  containerRef.current?.focus();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  containerRef.current?.focus();
                  setSelectedEdge({
                    sourceId: edge.source_id,
                    targetId: edge.target_id,
                  });
                }}
              />
            );
          })}

          {connection &&
            (() => {
              const source = graphIndexes.nodeMap.get(connection.sourceId);
              if (!source) return null;
              const x1 = source.pos_x + nodeWidth / 2;
              const y1 = source.pos_y + nodeHeight + 4;
              return (
                <path
                  d={`M ${x1} ${y1} C ${x1} ${y1 + 36}, ${connection.x} ${connection.y - 36}, ${connection.x} ${connection.y}`}
                  fill="none"
                  stroke={connection.targetId && !connection.targetIsValid ? "#dc4e4e" : "var(--color-accent)"}
                  strokeWidth="2"
                  strokeDasharray="5 5"
                />
              );
            })()}
        </svg>

        {selectedEdge &&
          (() => {
            const edgeIndex = edges.findIndex(
              (edge) =>
                edge.source_id === selectedEdge.sourceId &&
                edge.target_id === selectedEdge.targetId
            );
            const source = graphIndexes.nodeMap.get(selectedEdge.sourceId);
            const target = graphIndexes.nodeMap.get(selectedEdge.targetId);
            if (!source || !target || edgeIndex < 0) return null;
            const x =
              (source.pos_x + nodeWidth / 2 + target.pos_x + nodeWidth / 2) / 2;
            const y =
              (source.pos_y +
                nodeHeight +
                target.pos_y) /
                2 +
              ((edgeIndex % 3) - 1) * EDGE_MIDPOINT_STAGGER;
            return (
              <button
                type="button"
                data-canvas-toolbar
                onClick={() => {
                  const edge = selectedEdge;
                  setSelectedEdge(null);
                  void runCanvasAction(() =>
                    onDisconnectNodes(edge.sourceId, edge.targetId)
                  );
                }}
                className="pointer-events-auto absolute z-30 flex items-center gap-1 rounded-full border border-rose-200 bg-white px-2 py-1 text-[10px] font-semibold text-rose-700 shadow-md hover:bg-rose-50"
                style={{ left: x - 40, top: y - 16 }}
                title="Disconnect prerequisite"
              >
                <X className="h-3 w-3" />
                Disconnect
              </button>
            );
          })()}

        {displayNodes.map((node) => {
          const isSelected = node.id === selectedNodeId;
          const isLocked = node.status === "locked";
          const isMastered = node.status === "mastered";
          const isInProgress = node.status === "in_progress";
          const inLineage = !focusNodeId || lineageIds.has(node.id);
          const stateStyle = isMastered
            ? "node-mastered"
            : isInProgress
              ? "node-progress"
              : isLocked
                ? "node-locked"
                : "node-unlocked";
          const stateIcon = isMastered
            ? "text-[var(--color-success)]"
            : isInProgress
              ? "text-[var(--node-progress-accent)]"
              : isLocked
                ? "text-[var(--color-edge-muted)]"
                : "text-[var(--color-accent)]";
          const prerequisiteCount =
            graphIndexes.prerequisiteCounts.get(node.id) ?? 0;
          const hasInputConnection =
            connection?.targetId === node.id && connection.targetIsValid;
          const hasInvalidInputConnection =
            connection?.targetId === node.id && !connection.targetIsValid;
          const inputPortColor = isMastered
            ? "bg-[var(--color-success)]"
            : isInProgress
              ? "bg-[var(--node-progress-accent)]"
              : isLocked
                ? "bg-[var(--color-edge-muted)]"
                : "bg-[var(--color-accent)]";
          const rootTag =
            prerequisiteCount === 0
              ? "Foundation"
              : `${prerequisiteCount} prereq${prerequisiteCount === 1 ? "" : "s"}`;
          const progressLabel = isMastered
            ? "Mastered"
            : isInProgress
              ? quizNodeIds.has(node.id)
                ? "Quiz ready"
                : node.is_hydrated
                  ? "Lesson hydrated"
                  : "In progress"
              : isLocked
                ? "Locked"
                : node.is_hydrated
                  ? "Lesson hydrated"
                  : "Lesson not yet prepared";
          const dragTransition = isAnimatingLayout
            ? "left 350ms cubic-bezier(0.22, 1, 0.36, 1), top 350ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "none";

          return (
            <div
              key={node.id}
              data-dag-node
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setOpenMenuNodeId(node.id);
              }}
              style={{
                position: "absolute",
                left: node.pos_x,
                top: node.pos_y,
                width: nodeWidth,
                height: nodeHeight,
                zIndex: isSelected || openMenuNodeId === node.id ? 20 : 1,
                transition: dragTransition,
              }}
              className={`group pointer-events-auto ${inLineage ? "opacity-100" : "opacity-25"} ${
                isSelected ? "z-10" : ""
              }`}
            >
              <button
                type="button"
                onPointerDown={(e) => handleNodePointerDown(e, node)}
                onPointerMove={(e) => handleNodePointerMove(e, node.id)}
                onPointerUp={(e) => handleNodePointerUp(e, node.id)}
                onPointerCancel={(e) => handleNodePointerCancel(e, node.id)}
                onClick={() => {
                  if (suppressClickNodeId.current === node.id) {
                    suppressClickNodeId.current = null;
                    return;
                  }
                  setSelectedEdge(null);
                  onSelectNode(node.id);
                }}
                aria-label={`${node.title}, ${node.status}`}
                className={`relative flex h-full w-full flex-col justify-between overflow-hidden rounded-xl border text-left shadow-[0_3px_10px_rgba(35,51,60,0.07)] transition-[transform,opacity] duration-150 ease-[var(--ease-snap)] ${stateStyle} ${
                  layoutMode === "free"
                    ? "cursor-move active:cursor-grabbing"
                    : isLocked
                      ? "cursor-not-allowed"
                      : "cursor-pointer hover:-translate-y-0.5"
                } ${
                  nodeDensity === "compact" ? "px-2.5 py-1.5" : "px-3.5 py-2.5"
                } ${
                  isSelected
                    ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-canvas)]"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2 pr-5">
                  <div className="min-w-0">
                    <span
                      className={`block line-clamp-2 font-semibold leading-[1.25] ${
                        nodeDensity === "compact" ? "text-[10px]" : "text-[11px]"
                      }`}
                    >
                      {node.title}
                    </span>
                    {node.summary_hint && (
                      <div className="mt-1 block line-clamp-2 text-[9px] leading-3 text-slate-500">
                        {stripMathMarkup(node.summary_hint)}
                      </div>
                    )}
                  </div>
                  <span className={`mt-0.5 shrink-0 ${stateIcon}`}>
                    {isMastered ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : isLocked ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : isInProgress ? (
                      <Sparkles className="h-4 w-4" />
                    ) : (
                      <PlayCircle className="h-4 w-4" />
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 text-[9px] font-medium">
                  <span className="truncate text-slate-500">{progressLabel}</span>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono ${
                      node.in_degree_unmastered > 0
                        ? "bg-[#f0ece4] text-[#74654e]"
                        : "bg-[#eaf3ef] text-[#357467]"
                    }`}
                  >
                    {isLocked && node.in_degree_unmastered > 0
                      ? `${node.in_degree_unmastered} to unlock`
                      : rootTag}
                  </span>
                </div>
                <span
                  className={`absolute inset-x-0 bottom-0 h-[2px] ${
                    isMastered
                      ? "bg-[var(--color-success)]"
                      : isInProgress
                        ? "bg-[var(--node-progress-accent)]"
                        : isLocked
                          ? "bg-[var(--color-edge-muted)]"
                          : "bg-[var(--color-accent)]"
                  }`}
                  aria-hidden="true"
                />
              </button>

              <button
                type="button"
                aria-label={`${node.title} options`}
                title="Concept options"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  openMenu(node.id);
                }}
                className="pointer-events-auto absolute right-1 top-1 z-30 rounded-md bg-white/80 p-1 text-slate-500 opacity-0 shadow-sm transition hover:bg-white hover:text-slate-800 focus:opacity-100 group-hover:opacity-100"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                aria-label={`${node.title} prerequisite input`}
                title="Prerequisite input"
                onPointerDown={(e) => e.stopPropagation()}
                className={`pointer-events-auto absolute -top-[5px] left-1/2 z-20 h-[10px] w-[10px] -translate-x-1/2 rounded-full border-2 shadow-sm transition ${
                  hasInvalidInputConnection || invalidTargetId === node.id
                    ? "bg-red-500 ring-4 ring-red-200"
                    : hasInputConnection
                      ? "bg-emerald-500 ring-4 ring-emerald-200"
                      : connection && validTargetIds.has(node.id)
                        ? "bg-sky-500 ring-4 ring-sky-200"
                        : inputPortColor
                }`}
                style={{ borderColor: "var(--color-panel)" }}
              />

              <button
                type="button"
                aria-label={`${node.title} prerequisite output`}
                title="Drag to connect a prerequisite"
                onPointerDown={(e) => handleOutputPointerDown(e, node)}
                onPointerMove={handleOutputPointerMove}
                onPointerUp={handleOutputPointerUp}
                onPointerCancel={handleOutputPointerCancel}
                className={`pointer-events-auto absolute -bottom-[5px] left-1/2 z-20 h-[10px] w-[10px] -translate-x-1/2 rounded-full border-2 shadow-sm transition hover:scale-150 ${
                  isMastered
                    ? "bg-[var(--color-success)]"
                    : isInProgress
                      ? "bg-[var(--node-progress-accent)]"
                      : isLocked
                        ? "bg-[var(--color-edge-muted)]"
                        : "bg-[var(--color-accent)]"
                }`}
                style={{ borderColor: "var(--color-panel)" }}
              />

              {openMenuNodeId === node.id && (
                <div
                  data-canvas-popover
                  onPointerDown={(e) => e.stopPropagation()}
                  className="pointer-events-auto absolute right-0 top-7 z-40 w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-1 shadow-xl"
                >
                  <button
                    type="button"
                    onClick={() => openEditEditor(node)}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Concept
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDeleteNode(node);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive Concept
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editor && (
        <form
          data-canvas-popover
          onSubmit={(e) => void handleEditorSubmit(e)}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute z-40 w-[320px] rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 text-[var(--color-ink)] shadow-2xl"
          style={{ left: editor.left, top: editor.top }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold">
              {editor.mode === "add" ? "Add concept node" : "Edit concept"}
            </h2>
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="rounded-md p-1 text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
              aria-label="Close concept editor"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <label className="block text-[10px] font-medium text-[var(--color-muted)]">
            Concept Title
            <input
              autoFocus
              value={editorTitle}
              onChange={(e) => setEditorTitle(e.target.value)}
              maxLength={120}
              required
              className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)] px-2.5 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              placeholder="e.g. Graph traversal"
            />
          </label>
          <label className="mt-3 block text-[10px] font-medium text-[var(--color-muted)]">
            Short Summary <span className="font-normal">(optional)</span>
            <textarea
              value={editorSummary}
              onChange={(e) => setEditorSummary(e.target.value)}
              maxLength={240}
              rows={3}
              className="mt-1.5 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)] px-2.5 py-2 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              placeholder="What will students learn?"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="rounded-lg px-3 py-2 text-[10px] font-semibold text-[var(--color-muted)] hover:bg-[var(--color-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingEditor}
              className="rounded-lg bg-[var(--color-accent-button)] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-60"
            >
              {isSavingEditor
                ? "Saving…"
                : editor.mode === "add"
                  ? "Create Node"
                  : "Save Changes"}
            </button>
          </div>
        </form>
      )}

      {confirmDeleteNode && (
        <ConfirmDeleteModal
          mode="archive"
          title="Archive concept?"
          itemName={confirmDeleteNode.title}
          description="This removes the concept from the active graph but keeps its lesson, quiz, flashcards, worked examples, and prerequisite connections in this workspace’s Archive. Restore it later or permanently delete it from Archive."
          impactItems={[
            {
              label: "Dependent prerequisite edges",
              value: edges.filter(
                (edge) =>
                  edge.source_id === confirmDeleteNode.id ||
                  edge.target_id === confirmDeleteNode.id
              ).length,
            },
            {
              label: "Hydrated lesson",
              value: confirmDeleteNode.is_hydrated === 1 ? "Yes" : "No",
            },
          ]}
          deleteLabel="Archive concept"
          onCancel={() => setConfirmDeleteNode(null)}
          onConfirm={() => deleteNode(confirmDeleteNode)}
          onError={showError}
        />
      )}
      {showArchivedConcepts && workspaceId && (
        <ArchivedConceptsDialog
          workspaceId={workspaceId}
          onRestore={onRestoreArchivedNode}
          onPermanentlyDelete={onPermanentlyDeleteArchivedNode}
          onClose={() => setShowArchivedConcepts(false)}
          onToast={onToast}
        />
      )}

      <div
        data-canvas-toolbar
        className="absolute bottom-4 left-4 z-20 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-1.5 rounded-xl border border-[#e1dfd8] bg-white/95 p-1.5 shadow-[0_5px_18px_rgba(35,51,60,0.09)] backdrop-blur"
      >
        <div className="flex items-center gap-1 rounded-lg bg-[#f2f1ed] p-0.5">
          <button
            type="button"
            onClick={() => {
              animateCamera(170);
              const nextScale = Math.min(
                1.6,
                Number((scaleRef.current + 0.15).toFixed(2))
              );
              scaleRef.current = nextScale;
              setScale(nextScale);
            }}
            className="tactile-control rounded-lg p-1.5 text-slate-600 hover:bg-[#f2f1ed]"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <span className="min-w-[34px] px-1 text-center font-mono text-[10px] text-slate-500">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => {
              animateCamera(170);
              const nextScale = Math.max(
                0.35,
                Number((scaleRef.current - 0.15).toFixed(2))
              );
              scaleRef.current = nextScale;
              setScale(nextScale);
            }}
            className="tactile-control rounded-lg p-1.5 text-slate-600 hover:bg-[#f2f1ed]"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <div className="mx-1 h-4 w-px bg-[#e6e3dd]" />
          <button
            type="button"
            onClick={fitGraph}
            className="tactile-control flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-[#f2f1ed]"
            title="Recenter Graph"
          >
            <Compass className="h-3.5 w-3.5 text-[#326a9f]" />
            Fit to screen
          </button>
        </div>
        <div className="h-5 w-px bg-[#d8d5ce]" aria-hidden="true" />
        <div className="flex items-center rounded-lg border border-[#e6e3dd] bg-[#f8f7f4] p-0.5">
          <button
            type="button"
            onClick={() => void runCanvasAction(() => onSetLayoutMode("auto"))}
            className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${
              layoutMode === "auto"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Auto-Layout
          </button>
          <button
            type="button"
            onClick={() => void runCanvasAction(() => onSetLayoutMode("free"))}
            className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${
              layoutMode === "free"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Free Place
          </button>
          {layoutMode === "free" && (
            <>
              <button
                type="button"
                onClick={() => void resetToAutoLayout()}
                className="rounded-md px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-[#f2f1ed]"
                title="Restore Sugiyama positions and layer backdrops"
              >
                Reset Layout
              </button>
              <button
                type="button"
                onClick={() => void realignGrid()}
                className="rounded-md px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-[#f2f1ed]"
                title="Snap free-place nodes to the 16px grid"
              >
                Re-align Grid
              </button>
            </>
          )}
        </div>
        <div className="h-5 w-px bg-[#d8d5ce]" aria-hidden="true" />
        <div className="flex items-center gap-0.5 rounded-lg border border-[#e6e3dd] bg-[#f8f7f4] p-0.5">
          <button
            type="button"
            onClick={() => {
              const rect = containerRef.current?.getBoundingClientRect();
              openAddEditor((rect?.width ?? 900) / 2 - 150, 70);
            }}
            className="flex items-center gap-1 rounded-md bg-[var(--color-accent-button)] px-2.5 py-1.5 text-[10px] font-semibold text-white hover:brightness-95"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Node
          </button>
          <button
            type="button"
            disabled={!workspaceId}
            onClick={() => setShowArchivedConcepts(true)}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            title="View archived concepts"
          >
            <Archive className="h-3.5 w-3.5" />
            Archived concepts
          </button>
        </div>
      </div>
      <div className="absolute right-4 top-4 z-20 rounded-lg border border-[#e1dfd8] bg-white/90 px-3 py-2 text-[10px] text-slate-500 shadow-sm">
        <span className="inline-flex items-center gap-1">
          <Link2 className="h-3 w-3" />
          Hover to trace lineage
        </span>
      </div>
    </div>
  );
}
