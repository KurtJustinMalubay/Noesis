import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FolderKanban, GitBranch, Shapes } from "lucide-react";
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
  sidebarPortalTarget: HTMLElement | null;
  sidebarCollapsed: boolean;
  createBoardRequest: number;
  boardSearchQuery: string;
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
  sidebarPortalTarget,
  sidebarCollapsed,
  createBoardRequest,
  boardSearchQuery,
  onSelectNode,
  onToast,
}: ExcalidrawWorkspaceProps) {
  const [boards, setBoards] = useState<PluginBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const pendingSceneRef = useRef<{
    boardId: string;
    sceneJson: string;
  } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const initialFollowAppliedRef = useRef(false);
  const lastFollowedNodeIdRef = useRef<string | null>(selectedNode?.id ?? null);
  const handledBoardRequestRef = useRef<number | null>(null);
  const handledCreateBoardRequestRef = useRef(0);

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

  useEffect(() => {
    if (
      !boardsLoaded ||
      createBoardRequest === 0 ||
      handledCreateBoardRequestRef.current === createBoardRequest
    ) {
      return;
    }

    handledCreateBoardRequestRef.current = createBoardRequest;
    void createBoard(selectedNode);
  }, [boardsLoaded, createBoardRequest, selectedNode?.id]);

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
  const normalizedBoardSearch = boardSearchQuery.trim().toLocaleLowerCase();
  const matchesBoardSearch = (board: PluginBoard) =>
    sidebarCollapsed ||
    normalizedBoardSearch.length === 0 ||
    `${board.title} ${board.node_title ?? ""}`
      .toLocaleLowerCase()
      .includes(normalizedBoardSearch);
  const visibleNodeBoards = nodeBoards.filter(matchesBoardSearch);
  const visibleWorkspaceBoards = workspaceBoards.filter(matchesBoardSearch);
  const conceptSelector = (
    <select
      id="excalidraw-concept-selector"
      value={selectedNode?.id ?? ""}
      onChange={(event) =>
        void onSelectNode(event.target.value || null).catch((error) =>
          onToast(`Could not select concept: ${errorMessage(error)}`)
        )
      }
      aria-label="Current concept"
      title="Current concept"
      className={
        sidebarCollapsed
          ? "absolute inset-0 h-full w-full cursor-pointer opacity-0"
          : "mt-1.5 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-[10px] font-normal normal-case tracking-normal text-[var(--color-ink)]"
      }
    >
      <option value="">Workspace boards</option>
      {nodes.map((node) => (
        <option key={node.id} value={node.id}>
          {node.title}
        </option>
      ))}
    </select>
  );

  return (
    <>
      {sidebarPortalTarget &&
        createPortal(
          <aside className="flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden bg-[var(--color-sidebar)]">
            <div
              className={`border-b border-[var(--color-border)] ${
                sidebarCollapsed
                  ? "flex justify-center p-1"
                  : "px-3 py-2"
              }`}
            >
              {sidebarCollapsed ? (
                <div
                  className="relative grid h-10 w-10 place-items-center rounded-lg text-[var(--color-muted)] focus-within:ring-2 focus-within:ring-[var(--color-accent-soft)]"
                  title="Current concept"
                >
                  <GitBranch className="h-4 w-4" aria-hidden="true" />
                  {conceptSelector}
                </div>
              ) : (
                <label
                  htmlFor="excalidraw-concept-selector"
                  className="block text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted)]"
                >
                  Current concept
                  {conceptSelector}
                </label>
              )}
            </div>

            <div
              className={`min-h-0 flex-1 overflow-y-auto ${
                sidebarCollapsed ? "space-y-2 p-1" : "space-y-4 p-3"
              }`}
            >
          {loadError &&
            (sidebarCollapsed ? (
              <div
                role="alert"
                title={`Could not load boards: ${loadError}`}
                className="mx-auto grid h-10 w-10 place-items-center rounded-lg text-rose-700"
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Could not load boards: {loadError}</span>
              </div>
            ) : (
              <p
                role="alert"
                className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-[10px] leading-4 text-rose-800"
              >
                Could not load boards: {loadError}
              </p>
            ))}
          {!sidebarCollapsed && boardsLoaded && !loadError && boards.length === 0 && (
            <p className="px-1 text-[10px] leading-4 text-[var(--color-muted)]">
              Create a board to start capturing visual ideas.
            </p>
          )}
          {!sidebarCollapsed &&
            boardsLoaded &&
            !loadError &&
            boards.length > 0 &&
            visibleWorkspaceBoards.length + visibleNodeBoards.length === 0 && (
              <p className="px-2 py-3 text-[10px] text-[var(--color-muted)]">
              No boards match "{boardSearchQuery.trim()}".
              </p>
            )}
          {visibleWorkspaceBoards.length > 0 && (
            <section>
              {!sidebarCollapsed && (
                <h3 className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                  Workspace boards
                </h3>
              )}
              {visibleWorkspaceBoards.map((board) => (
                <BoardButton
                  key={board.id}
                  board={board}
                  active={board.id === activeBoardId}
                  collapsed={sidebarCollapsed}
                  onSelect={() => activateBoard(board)}
                />
              ))}
            </section>
          )}
          {visibleNodeBoards.length > 0 && (
            <section>
              {!sidebarCollapsed && (
                <h3 className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                  Concept boards
                </h3>
              )}
              {visibleNodeBoards.map((board) => (
                <BoardButton
                  key={board.id}
                  board={board}
                  active={board.id === activeBoardId}
                  collapsed={sidebarCollapsed}
                  onSelect={() => activateBoard(board)}
                  subtitle={board.node_title ?? "Deleted concept"}
                />
              ))}
            </section>
          )}
            </div>
          </aside>,
          sidebarPortalTarget
        )}

      <div
        className="excalidraw-workspace flex h-full min-h-0 min-w-0 flex-1 bg-[var(--color-panel)]"
      >
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
                Boards can belong to this workspace or follow an individual concept.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function BoardButton({
  board,
  active,
  collapsed,
  onSelect,
  subtitle,
}: {
  board: PluginBoard;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
  subtitle?: string;
}) {
  const Icon = board.node_id ? GitBranch : FolderKanban;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={subtitle ? `${board.title} · ${subtitle}` : board.title}
      aria-label={subtitle ? `${board.title}, ${subtitle}` : board.title}
      aria-current={active ? "page" : undefined}
      className={`mb-0.5 flex items-start rounded-lg text-left transition-colors ${
        collapsed
          ? "mx-auto h-10 w-10 items-center justify-center px-0"
          : "w-full gap-2 px-2.5 py-2"
      } ${
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
      }`}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 text-[var(--color-muted)] ${
          collapsed ? "" : "mt-0.5"
        }`}
      />
      <span className={collapsed ? "sr-only" : "min-w-0 flex-1"}>
        <span className="block truncate text-[11px] font-medium">
          {board.title}
        </span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-[9px] text-[var(--color-muted)]">
            {subtitle}
          </span>
        )}
      </span>
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
