import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  FilePlus2,
  Shapes,
} from "lucide-react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type {
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import {
  createPluginBoard,
  listPluginBoards,
  markPluginBoardOpened,
  savePluginBoardScene,
  type PluginBoard,
} from "../db/repositories/pluginBoardRepo";
import { EXCALIDRAW_PLUGIN_ID } from "../plugins/registry";
import type { AppearanceMode } from "../ai/keyStore";
import type { GraphNode } from "../types/domain";

interface ExcalidrawWorkspaceProps {
  workspaceId: string;
  openBoardRequest: {
    workspaceId: string;
    nodeId: string;
    requestId: number;
  } | null;
  onBoardRequestHandled: (requestId: number) => void;
  selectedNode: GraphNode | null;
  nodes: GraphNode[];
  appearanceMode: AppearanceMode;
  isFullscreen: boolean;
  onSelectNode: (nodeId: string | null) => Promise<void>;
  onToast: (message: string) => void;
}

const EMPTY_SCENE = JSON.stringify({
  elements: [],
  appState: {},
  files: {},
});

function parseScene(sceneJson: string): ExcalidrawInitialDataState {
  const parsed: unknown = JSON.parse(sceneJson);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("This board's saved scene is not a valid object.");
  }
  const scene = parsed as Record<string, unknown>;
  if (!Array.isArray(scene.elements)) {
    throw new Error("This board's saved scene has no valid elements list.");
  }
  if (
    scene.appState !== undefined &&
    (!scene.appState || typeof scene.appState !== "object")
  ) {
    throw new Error("This board's saved view settings are invalid.");
  }
  if (
    scene.files !== undefined &&
    (!scene.files || typeof scene.files !== "object")
  ) {
    throw new Error("This board's saved images are invalid.");
  }
  return parsed as ExcalidrawInitialDataState;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ExcalidrawWorkspace({
  workspaceId,
  openBoardRequest,
  onBoardRequestHandled,
  selectedNode,
  nodes,
  appearanceMode,
  isFullscreen,
  onSelectNode,
  onToast,
}: ExcalidrawWorkspaceProps) {
  const [boards, setBoards] = useState<PluginBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNewBoardMenu, setShowNewBoardMenu] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const pendingSceneRef = useRef<{
    boardId: string;
    sceneJson: string;
  } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const initialFollowAppliedRef = useRef(false);
  const lastFollowedNodeIdRef = useRef<string | null>(selectedNode?.id ?? null);
  const handledBoardRequestRef = useRef<number | null>(null);

  const activeBoard =
    boards.find((board) => board.id === activeBoardId) ?? null;
  const initialData = useMemo(() => {
    if (!activeBoard) return null;
    try {
      return parseScene(activeBoard.scene_json);
    } catch {
      return null;
    }
  }, [activeBoard]);

  const savePendingScene = () => {
    const pending = pendingSceneRef.current;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSceneRef.current = null;
    if (!pending) return;
    void savePluginBoardScene(pending.boardId, pending.sceneJson).catch(
      (error) => onToast(`Could not save board: ${errorMessage(error)}`)
    );
  };

  const activateBoard = (board: PluginBoard) => {
    savePendingScene();
    setActiveBoardId(board.id);
    setSceneError(null);
    void markPluginBoardOpened(board.id).catch((error) =>
      onToast(`Could not update board activity: ${errorMessage(error)}`)
    );
  };

  const activateBoardForNode = (nodeId: string | null) => {
    const board =
      boards.find((item) => item.node_id === nodeId) ?? null;
    if (board) activateBoard(board);
    else {
      savePendingScene();
      setActiveBoardId(null);
      setSceneError(null);
    }
  };

  useEffect(() => {
    let active = true;
    initialFollowAppliedRef.current = false;
    setBoardsLoaded(false);
    setLoadError(null);
    setActiveBoardId(null);
    listPluginBoards(workspaceId, EXCALIDRAW_PLUGIN_ID)
      .then((loadedBoards) => {
        if (active) setBoards(loadedBoards);
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (active) setBoardsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!boardsLoaded) return;
    const nodeId = selectedNode?.id ?? null;
    if (!initialFollowAppliedRef.current) {
      initialFollowAppliedRef.current = true;
      lastFollowedNodeIdRef.current = nodeId;
      activateBoardForNode(nodeId);
      return;
    }
    if (lastFollowedNodeIdRef.current === nodeId) return;
    lastFollowedNodeIdRef.current = nodeId;
    activateBoardForNode(nodeId);
  }, [boardsLoaded, boards, selectedNode?.id]);

  useEffect(() => {
    if (
      !boardsLoaded ||
      !openBoardRequest ||
      openBoardRequest.workspaceId !== workspaceId ||
      handledBoardRequestRef.current === openBoardRequest.requestId
    ) {
      return;
    }

    handledBoardRequestRef.current = openBoardRequest.requestId;
    let active = true;
    listPluginBoards(workspaceId, EXCALIDRAW_PLUGIN_ID)
      .then((loadedBoards) => {
        if (!active) return;
        const board = loadedBoards.find(
          (item) => item.node_id === openBoardRequest.nodeId
        );
        if (!board) {
          throw new Error("The lesson's Excalidraw board could not be loaded.");
        }
        savePendingScene();
        setBoards(loadedBoards);
        setActiveBoardId(board.id);
        setSceneError(null);
        void markPluginBoardOpened(board.id).catch((error) =>
          onToast(`Could not update board activity: ${errorMessage(error)}`)
        );
        onBoardRequestHandled(openBoardRequest.requestId);
      })
      .catch((error) => {
        if (active) {
          onToast(`Could not open lesson board: ${errorMessage(error)}`);
          onBoardRequestHandled(openBoardRequest.requestId);
        }
      });

    return () => {
      active = false;
    };
  }, [
    boardsLoaded,
    openBoardRequest?.requestId,
    workspaceId,
    onToast,
    onBoardRequestHandled,
  ]);

  useEffect(
    () => () => {
      const pending = pendingSceneRef.current;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (pending) {
        void savePluginBoardScene(pending.boardId, pending.sceneJson).catch(
          (error) => onToast(`Could not save board: ${errorMessage(error)}`)
        );
      }
    },
    []
  );

  const createBoard = async (node: GraphNode | null) => {
    savePendingScene();
    setShowNewBoardMenu(false);
    const now = Date.now();
    const boardId = crypto.randomUUID();
    try {
      await createPluginBoard({
        id: boardId,
        workspace_id: workspaceId,
        plugin_id: EXCALIDRAW_PLUGIN_ID,
        node_id: node?.id ?? null,
        title: node ? `${node.title} board` : "Workspace board",
        scene_json: EMPTY_SCENE,
        created_at: now,
      });
      const refreshedBoards = await listPluginBoards(
        workspaceId,
        EXCALIDRAW_PLUGIN_ID
      );
      setBoards(refreshedBoards);
      const createdBoard = refreshedBoards.find(
        (board) => board.id === boardId
      );
      if (!createdBoard) {
        throw new Error("The new Excalidraw board could not be loaded.");
      }
      setActiveBoardId(createdBoard.id);
      setSceneError(null);
      void markPluginBoardOpened(createdBoard.id).catch((error) =>
        onToast(`Could not update board activity: ${errorMessage(error)}`)
      );
    } catch (error) {
      onToast(`Could not create board: ${errorMessage(error)}`);
    }
  };

  const handleSceneChange = (
    boardId: string,
    elements: Parameters<NonNullable<ExcalidrawProps["onChange"]>>[0],
    appState: Parameters<NonNullable<ExcalidrawProps["onChange"]>>[1],
    files: Parameters<NonNullable<ExcalidrawProps["onChange"]>>[2]
  ) => {
    const sceneJson = JSON.stringify({
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom,
        gridSize: appState.gridSize,
      },
      files,
    });
    pendingSceneRef.current = { boardId, sceneJson };
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(savePendingScene, 500);
  };

  const nodeBoards = boards.filter((board) => board.node_id !== null);
  const workspaceBoards = boards.filter((board) => board.node_id === null);

  return (
    <div className="excalidraw-workspace flex h-full min-h-0 min-w-0 flex-1 bg-[var(--color-panel)]" data-fullscreen={isFullscreen}>
        <aside
          aria-hidden={isFullscreen}
          inert={isFullscreen}
          className={`flex shrink-0 flex-col overflow-hidden border-r bg-[var(--color-panel)] transition-[width,opacity,border-color] duration-300 ease-[var(--ease-spring)] ${
            isFullscreen
              ? "w-0 border-transparent opacity-0"
              : "w-60 border-[var(--color-border)] opacity-100"
          }`}
        >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Shapes className="h-4 w-4 text-[var(--color-accent)]" />
            Boards
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowNewBoardMenu((open) => !open)}
              className="flex items-center gap-1 rounded-md bg-[var(--color-accent-button)] px-2 py-1.5 text-[10px] font-semibold text-white hover:brightness-95"
              aria-expanded={showNewBoardMenu}
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              New
              <ChevronDown className="h-3 w-3" />
            </button>
            {showNewBoardMenu && (
              <div className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => void createBoard(null)}
                  className="w-full rounded-md px-2.5 py-2 text-left text-[11px] hover:bg-[var(--color-hover)]"
                >
                  Workspace board
                </button>
                <button
                  type="button"
                  disabled={!selectedNode}
                  onClick={() => selectedNode && void createBoard(selectedNode)}
                  className="w-full rounded-md px-2.5 py-2 text-left text-[11px] hover:bg-[var(--color-hover)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {selectedNode
                    ? `Board for ${selectedNode.title}`
                    : "Select a concept for a board"}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="border-b border-[var(--color-border)] px-3 py-2">
          <label className="block text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Follow concept
            <select
              value={selectedNode?.id ?? ""}
              onChange={(event) =>
                void onSelectNode(event.target.value || null).catch((error) =>
                  onToast(`Could not select concept: ${errorMessage(error)}`)
                )
              }
              className="mt-1.5 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-[10px] font-normal normal-case tracking-normal text-[var(--color-ink)]"
            >
              <option value="">Workspace boards</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {loadError && (
            <p className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-[10px] leading-4 text-rose-800">
              Could not load boards: {loadError}
            </p>
          )}
          {boardsLoaded && !loadError && boards.length === 0 && (
            <p className="px-1 text-[10px] leading-4 text-[var(--color-muted)]">
              Create a workspace board or a board for the selected concept.
            </p>
          )}
          {workspaceBoards.length > 0 && (
            <section>
              <h3 className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                Workspace
              </h3>
              {workspaceBoards.map((board) => (
                <BoardButton
                  key={board.id}
                  board={board}
                  active={board.id === activeBoardId}
                  onSelect={() => activateBoard(board)}
                />
              ))}
            </section>
          )}
          {nodeBoards.length > 0 && (
            <section>
              <h3 className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                Concepts
              </h3>
              {nodeBoards.map((board) => (
                <BoardButton
                  key={board.id}
                  board={board}
                  active={board.id === activeBoardId}
                  onSelect={() => activateBoard(board)}
                  subtitle={board.node_title ?? "Deleted concept"}
                />
              ))}
            </section>
          )}
        </div>
        </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          aria-hidden={isFullscreen}
          inert={isFullscreen}
          className={`flex shrink-0 items-center justify-between overflow-hidden border-b px-4 transition-[height,opacity,border-color] duration-300 ease-[var(--ease-spring)] ${
            isFullscreen
              ? "h-0 border-transparent opacity-0"
              : "h-11 border-[var(--color-border)] opacity-100"
          }`}
        >
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold">
              {activeBoard?.title ?? "Excalidraw"}
            </p>
            <p className="truncate text-[9px] text-[var(--color-muted)]">
              {activeBoard
                ? activeBoard.node_id
                  ? `Concept: ${activeBoard.node_title ?? "Unknown concept"}`
                  : "Workspace board"
                : "Select or create a board"}
            </p>
          </div>
          <span className="text-[9px] text-[var(--color-muted)]">
            {activeBoard ? "Saved locally" : ""}
          </span>
        </div>
        <div className="relative h-full min-h-0 min-w-0 w-full flex-1">
          {activeBoard && initialData ? (
            <Excalidraw
              key={activeBoard.id}
              initialData={initialData}
              theme={appearanceMode}
              onChange={(elements, appState, files) =>
                handleSceneChange(
                  activeBoard.id,
                  elements,
                  appState,
                  files
                )
              }
            />
          ) : activeBoard && sceneError ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <p className="max-w-md text-xs leading-5 text-rose-700">
                Could not open this board: {sceneError}
              </p>
            </div>
          ) : activeBoard ? (
            <SceneValidator
              board={activeBoard}
              onError={setSceneError}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <Shapes className="h-8 w-8 text-[var(--color-muted)]" />
              <p className="mt-3 text-sm font-semibold">Your visual workspace</p>
              <p className="mt-1 max-w-xs text-[11px] leading-5 text-[var(--color-muted)]">
                {isFullscreen
                  ? "Exit fullscreen to select or create a board."
                  : "Boards can belong to this workspace or follow an individual concept."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BoardButton({
  board,
  active,
  onSelect,
  subtitle,
}: {
  board: PluginBoard;
  active: boolean;
  onSelect: () => void;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`mb-0.5 w-full rounded-lg px-2.5 py-2 text-left transition ${
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
      }`}
    >
      <span className="block truncate text-[11px] font-medium">
        {board.title}
      </span>
      {subtitle && (
        <span className="mt-0.5 block truncate text-[9px] text-[var(--color-muted)]">
          {subtitle}
        </span>
      )}
    </button>
  );
}

function SceneValidator({
  board,
  onError,
}: {
  board: PluginBoard;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    try {
      parseScene(board.scene_json);
    } catch (error) {
      onError(errorMessage(error));
    }
  }, [board, onError]);
  return null;
}
