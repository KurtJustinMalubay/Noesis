import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Compass,
  Lock,
  PlayCircle,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { GraphEdge, GraphNode } from "../types/domain";
import { DEFAULT_LAYOUT_CONFIG } from "../engine/sugiyamaLayout";
import type { UserPreferences } from "../ai/keyStore";
import { stripMathMarkup } from "./ui/normalizeMathMarkdown";

interface DagCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  showDots: boolean;
  edgeRouting: UserPreferences["edgeRouting"];
  nodeDensity: UserPreferences["nodeDensity"];
  onSelectNode: (nodeId: string) => void;
}

export function DagCanvas({
  nodes,
  edges,
  selectedNodeId,
  showDots,
  edgeRouting,
  nodeDensity,
  onSelectNode,
}: DagCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphTrackRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 450, y: 80 });
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [cameraDuration, setCameraDuration] = useState<number | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const dragOrigin = useRef({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const scaleRef = useRef(scale);
  const cameraTimer = useRef<number | null>(null);
  const { nodeWidth, nodeHeight, verticalGap } = DEFAULT_LAYOUT_CONFIG;
  const graphKey = useMemo(
    () => nodes.map((node) => node.id).join(":"),
    [nodes]
  );
  const graphIndexes = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();
    const prerequisiteCounts = new Map<string, number>();
    const layerSet = new Set<number>();
    let minX = nodes.length ? Number.POSITIVE_INFINITY : 0;
    let minY = nodes.length ? Number.POSITIVE_INFINITY : 0;
    let maxX = nodes.length ? Number.NEGATIVE_INFINITY : 0;
    let maxY = nodes.length ? Number.NEGATIVE_INFINITY : 0;

    for (const node of nodes) {
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
  }, [nodes, edges, nodeWidth, nodeHeight]);
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

  useEffect(
    () => () => {
      if (cameraTimer.current !== null) {
        window.clearTimeout(cameraTimer.current);
      }
    },
    []
  );

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
    fitGraph();
  }, [graphKey]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-dag-node], button")) return;
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
    e.preventDefault();
    animateCamera(120);
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextScale = Math.min(
      1.6,
      Math.max(
        0.35,
        Number(
          (scaleRef.current + (e.deltaY < 0 ? 0.08 : -0.08)).toFixed(2)
        )
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
    setPan(nextPan);
    setScale(nextScale);
  };

  const layerStep = nodeHeight + verticalGap;
  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => {
        setHoveredNodeId(null);
      }}
      onWheel={handleWheel}
      className={`relative h-full w-full overflow-hidden bg-[var(--color-canvas)] select-none ${
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
        {graphIndexes.layerIndices.map((layer) => (
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
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--color-warning)" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const src = graphIndexes.nodeMap.get(edge.source_id);
            const tgt = graphIndexes.nodeMap.get(edge.target_id);
            if (!src || !tgt) return null;

            const x1 = src.pos_x + nodeWidth / 2;
            const y1 = src.pos_y + nodeHeight + 4;
            const x2 = tgt.pos_x + nodeWidth / 2;
            const y2 = tgt.pos_y - 4;
            const controlGap = Math.max(28, (y2 - y1) / 2);
            const isMastered = src.status === "mastered";
            const isLockedPath = tgt.status === "locked";
            const isInProgressPath = src.status === "in_progress";
            const inLineage =
              !focusNodeId ||
              (lineageIds.has(edge.source_id) && lineageIds.has(edge.target_id));
            const isUpstream = ancestors.has(edge.source_id) || ancestors.has(edge.target_id);
            const stroke = isMastered
              ? "var(--color-success)"
              : isInProgressPath
                ? "var(--color-warning)"
                : isLockedPath
                  ? "var(--color-edge-muted)"
              : isUpstream
                ? "var(--color-edge-upstream)"
                : "var(--color-edge-active)";
            const path = edgeRouting === "orthogonal"
              ? `M ${x1} ${y1} L ${x1} ${y1 + Math.max(22, (y2 - y1) / 2)} L ${x2} ${y1 + Math.max(22, (y2 - y1) / 2)} L ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1} ${y1 + controlGap}, ${x2} ${y2 - controlGap}, ${x2} ${y2}`;

            return (
              <path
                key={`${edge.source_id}-${edge.target_id}`}
                d={path}
                fill="none"
                stroke={stroke}
                strokeWidth={focusNodeId && inLineage ? 2.5 : isMastered ? 2 : 1.5}
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
                className="transition-opacity"
              />
            );
          })}
        </svg>

        {nodes.map((node) => {
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
            ? "text-[#19816f]"
            : isInProgress
              ? "text-[#b7792d]"
              : isLocked
                ? "text-[#8f9a9e]"
                : "text-[#326a9f]";
          const prerequisiteCount =
            graphIndexes.prerequisiteCounts.get(node.id) ?? 0;

          return (
            <button
              key={node.id}
              data-dag-node
              onClick={() => onSelectNode(node.id)}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              style={{
                position: "absolute",
                left: node.pos_x,
                top: node.pos_y,
                width: nodeWidth,
                height: nodeHeight,
              }}
              aria-label={`${node.title}, layer ${node.layer_index + 1}, ${node.status}`}
              className={`pointer-events-auto flex flex-col justify-between rounded-xl border text-left shadow-[0_3px_10px_rgba(35,51,60,0.07)] transition-[transform,opacity] duration-150 ease-[var(--ease-snap)] ${stateStyle} ${
                isLocked ? "cursor-not-allowed" : "cursor-pointer hover:-translate-y-0.5"
              } ${inLineage ? "opacity-100" : "opacity-25"} ${
                nodeDensity === "compact" ? "px-2.5 py-1.5" : "px-3.5 py-2.5"
                } ${
                isSelected
                ? "z-10 ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-canvas)]"
                  : ""
              }`}
            >
              <span className="absolute -top-[5px] left-1/2 h-[8px] w-[8px] -translate-x-1/2 rounded-full border-2 bg-[var(--color-edge-muted)] shadow-sm" style={{ borderColor: "var(--color-panel)" }} />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">
                    Layer {node.layer_index + 1}
                  </span>
                  <span className={`mt-1 block line-clamp-2 font-semibold leading-[1.25] ${nodeDensity === "compact" ? "text-[10px]" : "text-[11px]"}`}>
                    {node.title}
                  </span>
                  {node.summary_hint && (
                    <div className="mt-1 block truncate text-[9px] leading-3 text-slate-500">
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
                <span className="truncate text-slate-500">
                  {isMastered
                    ? "Mastered"
                    : isInProgress
                      ? "In progress"
                      : isLocked
                        ? "Locked"
                        : node.is_hydrated
                          ? "Ready to study"
                          : "Lesson not yet prepared"}
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono ${
                    node.in_degree_unmastered > 0
                      ? "bg-[#f0ece4] text-[#74654e]"
                      : "bg-[#eaf3ef] text-[#357467]"
                  }`}
                >
                  {isLocked && node.in_degree_unmastered > 0
                    ? `${node.in_degree_unmastered} to unlock`
                    : `${prerequisiteCount} prereq${prerequisiteCount === 1 ? "" : "s"}`}
                </span>
              </div>
              <span className="absolute -bottom-[5px] left-1/2 h-[8px] w-[8px] -translate-x-1/2 rounded-full border-2 bg-[var(--color-accent)] shadow-sm" style={{ borderColor: "var(--color-panel)" }} />
            </button>
          );
        })}
      </div>

      <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-xl border border-[#e1dfd8] bg-white/95 p-1.5 shadow-[0_5px_18px_rgba(35,51,60,0.09)] backdrop-blur">
        <button
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
          onClick={fitGraph}
          className="tactile-control flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-[#f2f1ed]"
          title="Recenter Graph"
        >
          <Compass className="h-3.5 w-3.5 text-[#326a9f]" />
          Fit to screen
        </button>
      </div>
      <div className="absolute bottom-4 right-4 rounded-lg border border-[#e1dfd8] bg-white/90 px-3 py-2 text-[10px] text-slate-500 shadow-sm">
        Hover to trace lineage
      </div>
    </div>
  );
}
