import {
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useRef,
  useState,
  type FormEvent,
  type TransitionEvent,
} from "react";
import {
  BookOpen,
  Bot,
  Check,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  Settings2,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  askGroundedTutor,
  summarizeTutorThread,
} from "../ai/curriculumService";
import { AnimatedPresence } from "./AnimatedPresence";
import {
  clearTutorThreadMessages,
  countTutorThreadMessages,
  createTutorThread,
  createTutorThreadTitle,
  deleteTutorThread,
  insertTutorMessage,
  listTutorThreads,
  loadTutorMessagePage,
  renameTutorThread,
  updateTutorMessage,
  updateTutorThread,
  type TutorLessonContext,
  type TutorMessage,
  type TutorMessageCursor,
  type TutorThread,
} from "../db/repositories/tutorRepo";
import type { GraphNode } from "../types/domain";
import { RichContent } from "./ui/RichContent";
import type { TutorPayload } from "../ai/tokenOptimizer";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

interface TutorDrawerProps {
  isOpen: boolean;
  activeLesson: GraphNode | null;
  activeNodeTitle?: string;
  workspaceId: string | null;
  onPanelReady: () => void;
  onToast: (message: string | null) => void;
}

interface ThreadGroup {
  title: string;
  threads: TutorThread[];
}

type TutorDeleteConfirmation =
  | {
      kind: "thread";
      thread: TutorThread;
      messageCount: number;
    }
  | {
      kind: "history";
      threadId: string;
      threadTitle: string;
      messageCount: number;
    };

interface TutorChatSettings {
  askFollowUpQuestions: boolean;
  preferConciseReplies: boolean;
}

const TUTOR_SETTINGS_KEY = "noesis.tutor-chat-settings.v1";
const DEFAULT_TUTOR_SETTINGS: TutorChatSettings = {
  askFollowUpQuestions: true,
  preferConciseReplies: false,
};

function loadTutorChatSettings(): TutorChatSettings {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(TUTOR_SETTINGS_KEY) ?? "null"
    );
    if (!saved || typeof saved !== "object") return DEFAULT_TUTOR_SETTINGS;
    const settings = saved as Partial<TutorChatSettings>;
    return {
      askFollowUpQuestions:
        typeof settings.askFollowUpQuestions === "boolean"
          ? settings.askFollowUpQuestions
          : DEFAULT_TUTOR_SETTINGS.askFollowUpQuestions,
      preferConciseReplies:
        typeof settings.preferConciseReplies === "boolean"
          ? settings.preferConciseReplies
          : DEFAULT_TUTOR_SETTINGS.preferConciseReplies,
    };
  } catch {
    return DEFAULT_TUTOR_SETTINGS;
  }
}

function toLessonContext(node: GraphNode): TutorLessonContext {
  return {
    id: node.id,
    title: node.title,
    summaryHint: node.summary_hint,
    layerIndex: node.layer_index,
    lessonMarkdown: node.lesson_markdown,
  };
}

function groupThreads(threads: TutorThread[]): ThreadGroup[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const previousWeekStart = new Date(todayStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);

  const groups: Record<"Today" | "Previous 7 Days" | "Older", TutorThread[]> = {
    Today: [],
    "Previous 7 Days": [],
    Older: [],
  };

  for (const thread of threads) {
    if (thread.updated_at >= todayStart.getTime()) {
      groups.Today.push(thread);
    } else if (thread.updated_at >= previousWeekStart.getTime()) {
      groups["Previous 7 Days"].push(thread);
    } else {
      groups.Older.push(thread);
    }
  }

  return Object.entries(groups)
    .map(([title, groupedThreads]) => ({ title, threads: groupedThreads }))
    .filter((group) => group.threads.length > 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TutorMessageBubble = memo(function TutorMessageBubble({
  message,
  isActiveStream,
}: {
  message: TutorMessage;
  isActiveStream: boolean;
}) {
  return (
    <div
      className={`mb-3 rounded-xl p-3 text-xs ${
        message.role === "user"
          ? "ml-6 bg-[var(--color-accent-soft)] text-[var(--color-ink)]"
          : "mr-4 border border-[var(--color-border)] bg-[var(--color-panel)] text-[var(--color-ink)] shadow-[0_2px_8px_rgba(35,51,60,0.04)]"
      }`}
    >
      {message.attached_lesson_title && (
        <p className="mb-2 flex items-center gap-1 border-b border-[var(--color-border)] pb-1.5 text-[9px] font-semibold text-[var(--color-accent)]">
          <BookOpen className="h-3 w-3" />
          {message.attached_lesson_title}
        </p>
      )}
      <div className="prose lesson-prose prose-xs max-w-none select-text">
        {message.content ? (
          <RichContent>{message.content}</RichContent>
        ) : message.role === "assistant" && isActiveStream ? (
          <span
            className="inline-flex items-center gap-1 py-1 text-[var(--color-muted)]"
            aria-label="Tutor is responding"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
          </span>
        ) : null}
        {message.role === "assistant" &&
          isActiveStream &&
          message.content && (
            <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-[var(--color-accent)] align-middle" />
          )}
      </div>
      {message.citations.length > 0 && (
        <p className="mt-2 border-t border-[var(--color-border)] pt-1.5 text-[10px] text-[var(--color-accent)]">
          Sources: {message.citations.join(", ")}
        </p>
      )}
    </div>
  );
});

export function TutorDrawer({
  isOpen,
  activeLesson,
  activeNodeTitle,
  workspaceId,
  onPanelReady,
  onToast,
}: TutorDrawerProps) {
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const [input, setInput] = useState("");
  const [threads, setThreads] = useState<TutorThread[]>([]);
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<TutorDeleteConfirmation | null>(null);
  const [preparingDeleteThreadId, setPreparingDeleteThreadId] = useState<
    string | null
  >(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [attachedLesson, setAttachedLesson] =
    useState<TutorLessonContext | null>(null);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [nextCursor, setNextCursor] = useState<TutorMessageCursor | null>(
    null
  );
  const [sendingThreadId, setSendingThreadId] = useState<string | null>(null);
  const [payloadMetrics, setPayloadMetrics] = useState<
    Pick<TutorPayload, "totalTokens" | "savedPercent"> | null
  >(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [chatSettings, setChatSettings] = useState(loadTutorChatSettings);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const skipLoadThreadRef = useRef<string | null>(null);
  const threadLoadGenerationRef = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const enterFramesRef = useRef<number[]>([]);
  const exitTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    const maxHeight = 124;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, maxHeight)}px`;
    composer.style.overflowY =
      composer.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input, isRendered]);
  const isLoadingOlderRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const forceScrollToBottomRef = useRef(false);
  const isPrependingMessagesRef = useRef(false);
  const pendingScrollAnchorRef = useRef<{
    height: number;
    top: number;
  } | null>(null);
  const onPanelReadyRef = useRef(onPanelReady);
  onPanelReadyRef.current = onPanelReady;

  const isSending = Boolean(
    activeThreadId && sendingThreadId === activeThreadId
  );

  const updateChatSettings = (settings: TutorChatSettings) => {
    setChatSettings(settings);
    try {
      localStorage.setItem(TUTOR_SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      onToast(`Unable to save tutor settings: ${errorMessage(error)}`);
    }
  };

  const setCurrentThread = (threadId: string | null) => {
    activeThreadIdRef.current = threadId;
    setActiveThreadId(threadId);
  };

  useEffect(() => {
    onPanelReadyRef.current();
  }, []);

  useEffect(() => {
    if (!isOpen) setDeleteConfirmation(null);
  }, [isOpen]);

  useEffect(() => {
    enterFramesRef.current.forEach((frame) => cancelAnimationFrame(frame));
    enterFramesRef.current = [];
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    if (isOpen) {
      setIsRendered(true);
      setIsVisible(false);
      const firstFrame = requestAnimationFrame(() => {
        const secondFrame = requestAnimationFrame(() => setIsVisible(true));
        enterFramesRef.current = [secondFrame];
      });
      enterFramesRef.current = [firstFrame];
    } else {
      controllerRef.current?.abort();
      setIsVisible(false);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setIsRendered(false);
      } else {
        exitTimerRef.current = window.setTimeout(
          () => setIsRendered(false),
          320
        );
      }
    }

    return () => {
      enterFramesRef.current.forEach((frame) => cancelAnimationFrame(frame));
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;

    listTutorThreads(workspaceId)
      .then((loadedThreads) => {
        if (!active) return;
        setThreads(loadedThreads);
        const currentId = activeThreadIdRef.current;
        const currentThread = loadedThreads.find(
          (thread) => thread.id === currentId
        );
        const nextThread = currentThread ?? loadedThreads[0] ?? null;
        if (nextThread?.id !== currentId) {
          setCurrentThread(nextThread?.id ?? null);
          setAttachedLesson(nextThread?.lessonContext ?? null);
        } else if (nextThread && !currentId) {
          setAttachedLesson(nextThread.lessonContext);
        }
      })
      .catch((error: unknown) => onToast(`Unable to load tutor history: ${errorMessage(error)}`));

    return () => {
      active = false;
    };
  }, [isOpen, workspaceId, onToast]);

  useEffect(() => {
    const threadId = activeThreadId;
    const generation = ++threadLoadGenerationRef.current;

    if (!threadId) {
      setMessages([]);
      setNextCursor(null);
      setHasMoreMessages(false);
      setIsLoadingThread(false);
      pendingScrollAnchorRef.current = null;
      isPrependingMessagesRef.current = false;
      return;
    }

    if (skipLoadThreadRef.current === threadId) {
      skipLoadThreadRef.current = null;
      setMessages([]);
      setNextCursor(null);
      setHasMoreMessages(false);
      setIsLoadingThread(false);
      pendingScrollAnchorRef.current = null;
      isPrependingMessagesRef.current = false;
      return;
    }

    setMessages([]);
    setIsLoadingThread(true);
    setHasMoreMessages(false);
    setNextCursor(null);
    void loadTutorMessagePage(threadId)
      .then((page) => {
        if (
          generation !== threadLoadGenerationRef.current ||
          activeThreadIdRef.current !== threadId
        ) {
          return;
        }
        forceScrollToBottomRef.current = true;
        setMessages(page.messages);
        setHasMoreMessages(page.hasMore);
        setNextCursor(page.nextCursor);
      })
      .catch((error: unknown) => {
        if (generation === threadLoadGenerationRef.current) {
          onToast(`Unable to load tutor messages: ${errorMessage(error)}`);
        }
      })
      .finally(() => {
        if (generation === threadLoadGenerationRef.current) {
          setIsLoadingThread(false);
        }
      });

    return () => {
      threadLoadGenerationRef.current += 1;
    };
  }, [activeThreadId, onToast]);

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const anchor = pendingScrollAnchorRef.current;
    if (anchor && isPrependingMessagesRef.current) {
      container.scrollTop =
        anchor.top + (container.scrollHeight - anchor.height);
      pendingScrollAnchorRef.current = null;
      isPrependingMessagesRef.current = false;
      return;
    }

    if (forceScrollToBottomRef.current || shouldStickToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
      forceScrollToBottomRef.current = false;
    }
  }, [messages]);

  const refreshThreads = useCallback(async () => {
    const loadedThreads = await listTutorThreads(workspaceId);
    setThreads(loadedThreads);
  }, [workspaceId]);

  const loadOlderMessages = useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    const container = messagesContainerRef.current;
    if (
      !threadId ||
      !hasMoreMessages ||
      !nextCursor ||
      isLoadingOlderRef.current ||
      !container
    ) {
      return;
    }

    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);
    pendingScrollAnchorRef.current = {
      height: container.scrollHeight,
      top: container.scrollTop,
    };

    try {
      const page = await loadTutorMessagePage(threadId, nextCursor);
      if (activeThreadIdRef.current !== threadId) {
        pendingScrollAnchorRef.current = null;
        return;
      }
      isPrependingMessagesRef.current = true;
      setMessages((currentMessages) => [
        ...page.messages,
        ...currentMessages,
      ]);
      setHasMoreMessages(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (error) {
      pendingScrollAnchorRef.current = null;
      isPrependingMessagesRef.current = false;
      onToast(`Unable to load older tutor messages: ${errorMessage(error)}`);
    } finally {
      isLoadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [hasMoreMessages, nextCursor, onToast]);

  useEffect(() => {
    const root = messagesContainerRef.current;
    const sentinel = topSentinelRef.current;
    if (!root || !sentinel || !activeThreadId || !hasMoreMessages) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadOlderMessages();
      },
      { root, rootMargin: "72px 0px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeThreadId, hasMoreMessages, loadOlderMessages]);

  const stopGeneration = () => controllerRef.current?.abort();

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = input.trim();
    if (
      !prompt ||
      isLoadingThread ||
      (controllerRef.current && !controllerRef.current.signal.aborted)
    ) {
      return;
    }

    const conversationHistory = messages
      .filter((message) => message.content)
      .slice(-6)
      .map((message) => ({
        role: message.role,
        content: message.content,
        attached_lesson_title: message.attached_lesson_title,
      }));
    let threadId = activeThreadIdRef.current;
    let assistantMessageId = "";
    let userMessage: TutorMessage;
    let assistantMessage: TutorMessage;

    try {
      const currentThread = threads.find((thread) => thread.id === threadId);
      const isFirstPrompt = !currentThread || currentThread.title === "New chat";
      const title = isFirstPrompt ? createTutorThreadTitle(prompt) : undefined;

      if (!threadId) {
        const thread = await createTutorThread(
          workspaceId,
          title ?? createTutorThreadTitle(prompt),
          attachedLesson?.id ?? null
        );
        const createdThread = {
          ...thread,
          lessonContext: attachedLesson,
        };
        threadId = thread.id;
        skipLoadThreadRef.current = thread.id;
        setCurrentThread(thread.id);
        setThreads((current) => [createdThread, ...current]);
      } else {
        await updateTutorThread(threadId, {
          workspaceId,
          nodeId: attachedLesson?.id ?? null,
          title,
        });
        setThreads((current) =>
          current.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  title: title ?? thread.title,
                  workspace_id: workspaceId,
                  node_id: attachedLesson?.id ?? null,
                  lessonContext: attachedLesson,
                  updated_at: Date.now(),
                }
              : thread
          )
        );
      }

      userMessage = {
        id: crypto.randomUUID(),
        thread_id: threadId,
        role: "user",
        content: prompt,
        attached_lesson_title: attachedLesson?.title ?? null,
        citations: [],
        created_at: Date.now(),
      };
      assistantMessageId = crypto.randomUUID();
      assistantMessage = {
        id: assistantMessageId,
        thread_id: threadId,
        role: "assistant",
        content: "",
        attached_lesson_title: attachedLesson?.title ?? null,
        citations: [],
        created_at: Date.now(),
      };
      await insertTutorMessage(userMessage);
      await insertTutorMessage(assistantMessage);
    } catch (error) {
      setInput(prompt);
      onToast(`Unable to save tutor message: ${errorMessage(error)}`);
      return;
    }

    setInput("");
    shouldStickToBottomRef.current = true;
    setMessages((current) =>
      activeThreadIdRef.current === threadId
        ? [...current, userMessage, assistantMessage]
        : current
    );

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setSendingThreadId(threadId);
    const streamedChunks: string[] = [];
    let updateFrame: number | null = null;
    const cancelPendingUpdate = () => {
      if (updateFrame !== null) {
        cancelAnimationFrame(updateFrame);
        updateFrame = null;
      }
    };

    try {
      const { reply, citations } = await askGroundedTutor(
        prompt,
        activeNodeTitle,
        workspaceId ?? undefined,
        {
          signal: controller.signal,
          lessonContext: attachedLesson,
          rollingSummary: threads.find((thread) => thread.id === threadId)
            ?.rolling_summary,
          history: conversationHistory,
          askFollowUpQuestions: chatSettings.askFollowUpQuestions,
          preferConciseReplies: chatSettings.preferConciseReplies,
          onPayload: setPayloadMetrics,
          onChunk: (chunk) => {
            streamedChunks.push(chunk);
            if (updateFrame === null) {
              updateFrame = requestAnimationFrame(() => {
                updateFrame = null;
                const content = streamedChunks.join("");
                if (activeThreadIdRef.current === threadId) {
                  setMessages((current) =>
                    current.map((message) =>
                      message.id === assistantMessageId
                        ? { ...message, content }
                        : message
                    )
                  );
                }
              });
            }
          },
        }
      );
      cancelPendingUpdate();
      await updateTutorMessage(assistantMessageId, reply, citations);
      if (activeThreadIdRef.current === threadId) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: reply, citations }
              : message
          )
        );
      }
      await refreshThreads().catch((refreshError: unknown) =>
        onToast(`Unable to refresh tutor history: ${errorMessage(refreshError)}`)
      );
      const threadForSummary = threads.find(
        (thread) => thread.id === threadId
      );
      if (threadForSummary) {
        void summarizeTutorThread(threadForSummary)
          .then(refreshThreads)
          .catch((summaryError: unknown) =>
            onToast(
              `Unable to update tutor memory: ${errorMessage(summaryError)}`
            )
          );
      }
    } catch (error) {
      cancelPendingUpdate();
      const stopped = controller.signal.aborted;
      const partialReply = streamedChunks.join("");
      const content = stopped
        ? partialReply
          ? `${partialReply}\n\n_Stopped._`
          : "_Stopped._"
        : partialReply
          ? `${partialReply}\n\n_Stream interrupted: ${errorMessage(error)}_`
          : `Error: ${errorMessage(error)}`;
      await updateTutorMessage(assistantMessageId, content).catch(
        (saveError: unknown) =>
          onToast(`Unable to save tutor response: ${errorMessage(saveError)}`)
      );
      if (activeThreadIdRef.current === threadId) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content, citations: [] }
              : message
          )
        );
      }
      if (!stopped) onToast(content);
      await refreshThreads().catch((refreshError: unknown) =>
        onToast(`Unable to refresh tutor history: ${errorMessage(refreshError)}`)
      );
    } finally {
      cancelPendingUpdate();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setSendingThreadId(null);
      }
    }
  };

  const createNewChat = async () => {
    stopGeneration();
    try {
      const thread = await createTutorThread(workspaceId);
      skipLoadThreadRef.current = thread.id;
      setCurrentThread(thread.id);
      setAttachedLesson(null);
      setPayloadMetrics(null);
      setMessages([]);
      setHasMoreMessages(false);
      setNextCursor(null);
      setThreads((current) => [thread, ...current]);
      setIsHistoryOpen(false);
    } catch (error) {
      onToast(`Unable to create tutor chat: ${errorMessage(error)}`);
    }
  };

  const selectThread = (thread: TutorThread) => {
    if (thread.id === activeThreadIdRef.current) {
      setIsHistoryOpen(false);
      return;
    }
    stopGeneration();
    setCurrentThread(thread.id);
    setAttachedLesson(thread.lessonContext);
    setPayloadMetrics(null);
    setIsHistoryOpen(false);
    setRenamingThreadId(null);
  };

  const handleDeleteThread = async (thread: TutorThread) => {
    const isActive = thread.id === activeThreadIdRef.current;
    if (isActive) stopGeneration();
    await deleteTutorThread(thread.id);
    const remainingThreads = threads.filter(
      (candidate) => candidate.id !== thread.id
    );
    setThreads(remainingThreads);
    if (isActive) {
      const nextThread = remainingThreads[0] ?? null;
      setCurrentThread(nextThread?.id ?? null);
      setAttachedLesson(nextThread?.lessonContext ?? null);
    }
  };

  const requestThreadDeletion = async (thread: TutorThread) => {
    if (preparingDeleteThreadId) return;
    setPreparingDeleteThreadId(thread.id);
    try {
      const messageCount = await countTutorThreadMessages(thread.id);
      setDeleteConfirmation({ kind: "thread", thread, messageCount });
    } catch (error) {
      onToast(`Unable to inspect tutor chat: ${errorMessage(error)}`);
    } finally {
      setPreparingDeleteThreadId(null);
    }
  };

  const requestChatHistoryClear = async () => {
    const threadId = activeThreadIdRef.current;
    if (!threadId || preparingDeleteThreadId) return;
    setPreparingDeleteThreadId(threadId);
    try {
      const messageCount = await countTutorThreadMessages(threadId);
      const thread = threads.find((item) => item.id === threadId);
      setDeleteConfirmation({
        kind: "history",
        threadId,
        threadTitle: thread?.title ?? "Current tutor chat",
        messageCount,
      });
    } catch (error) {
      onToast(`Unable to inspect tutor chat: ${errorMessage(error)}`);
    } finally {
      setPreparingDeleteThreadId(null);
    }
  };

  const handleRenameThread = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renamingThreadId || !renameValue.trim()) return;
    try {
      await renameTutorThread(renamingThreadId, renameValue);
      setThreads((current) =>
        current.map((thread) =>
          thread.id === renamingThreadId
            ? {
                ...thread,
                title: renameValue.trim(),
                updated_at: Date.now(),
              }
            : thread
        )
      );
      setRenamingThreadId(null);
      setRenameValue("");
    } catch (error) {
      onToast(`Unable to rename tutor chat: ${errorMessage(error)}`);
    }
  };

  const updateAttachedLesson = async (
    lessonContext: TutorLessonContext | null
  ) => {
    const threadId = activeThreadIdRef.current;
    if (threadId) {
      try {
        await updateTutorThread(threadId, {
          workspaceId,
          nodeId: lessonContext?.id ?? null,
        });
        setThreads((current) =>
          current.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  node_id: lessonContext?.id ?? null,
                  lessonContext,
                  updated_at: Date.now(),
                }
              : thread
          )
        );
      } catch (error) {
        onToast(`Unable to update lesson context: ${errorMessage(error)}`);
        return;
      }
    }
    setAttachedLesson(lessonContext);
  };

  const handleClearChat = async (threadId: string) => {
    if (threadId === activeThreadIdRef.current) stopGeneration();
    await clearTutorThreadMessages(threadId);
    if (activeThreadIdRef.current === threadId) {
      setMessages([]);
      setHasMoreMessages(false);
      setNextCursor(null);
      shouldStickToBottomRef.current = true;
    }
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              rolling_summary: "",
              summary_cursor_created_at: null,
              summary_cursor_id: null,
            }
          : thread
      )
    );
  };

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.clientHeight - container.scrollTop;
    shouldStickToBottomRef.current = distanceFromBottom < 80;
  };

  const handleTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
    if (
      isOpen ||
      event.target !== event.currentTarget ||
      event.propertyName !== "transform"
    ) {
      return;
    }
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setIsRendered(false);
  };

  if (!isRendered) return null;

  const groupedThreads = groupThreads(threads);
  const activeThread = threads.find(
    (thread) => thread.id === activeThreadId
  );
  const availableLesson = activeLesson
    ? toLessonContext(activeLesson)
    : null;

  return (
    <aside
      onTransitionEnd={handleTransitionEnd}
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={`tutor-drawer-panel absolute inset-y-0 right-0 flex h-full max-w-full flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-panel)] shadow-[-12px_0_30px_rgba(35,51,60,0.12)] ${
        isVisible ? "tutor-drawer-panel-visible" : ""
      }`}
    >
      <div className="relative flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-[var(--color-ink)]">
              Socratic Tutor
            </h3>
            <p className="max-w-[170px] truncate text-[10px] text-[var(--color-muted)]">
              {activeThread?.title ?? "Grounded in your local vault"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setIsHistoryOpen(false);
              setIsSettingsOpen((open) => !open);
            }}
            className={`rounded-lg p-1.5 transition hover:bg-[var(--color-hover)] ${
              isSettingsOpen
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-muted)]"
            }`}
            aria-label="Tutor settings"
            aria-expanded={isSettingsOpen}
            title="Tutor settings"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsSettingsOpen(false);
              setIsHistoryOpen((open) => !open);
            }}
            className={`rounded-lg p-1.5 transition hover:bg-[var(--color-hover)] ${
              isHistoryOpen
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-muted)]"
            }`}
            aria-label="Toggle tutor history"
            aria-expanded={isHistoryOpen}
            title="History"
          >
            <History className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void createNewChat()}
            className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-ink)] transition hover:bg-[var(--color-hover)]"
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void requestChatHistoryClear()}
            disabled={
              !activeThreadId || preparingDeleteThreadId === activeThreadId
            }
            className="rounded-lg p-1.5 text-[var(--color-muted)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] disabled:opacity-40"
            title="Clear current chat"
            aria-label="Clear current chat"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <AnimatedPresence
          present={isSettingsOpen}
          motion="popover"
          className="absolute right-3 top-full z-30 mt-2 w-64"
          exitDuration={170}
        >
          <div className="motion-popover space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-3 shadow-[0_16px_44px_rgba(31,43,51,0.18)]">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
              Tutor behavior
            </p>
            <label className="flex items-center justify-between gap-3 text-[11px] text-[var(--color-ink)]">
              <span>Ask follow-up questions</span>
              <input
                type="checkbox"
                checked={chatSettings.askFollowUpQuestions}
                onChange={(event) =>
                  updateChatSettings({
                    ...chatSettings,
                    askFollowUpQuestions: event.target.checked,
                  })
                }
                aria-label="Ask follow-up questions"
                className="accent-[var(--color-accent)]"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-[11px] text-[var(--color-ink)]">
              <span>Prefer concise replies</span>
              <input
                type="checkbox"
                checked={chatSettings.preferConciseReplies}
                onChange={(event) =>
                  updateChatSettings({
                    ...chatSettings,
                    preferConciseReplies: event.target.checked,
                  })
                }
                aria-label="Prefer concise replies"
                className="accent-[var(--color-accent)]"
              />
            </label>
          </div>
        </AnimatedPresence>

        <AnimatedPresence
          present={isHistoryOpen}
          motion="popover"
          className="absolute right-3 top-full z-30 mt-2 w-[min(340px,calc(100vw-32px))]"
          exitDuration={170}
        >
          <div className="motion-popover origin-top-right max-h-[min(60vh,480px)] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-2 shadow-[0_16px_44px_rgba(31,43,51,0.18)]">
            {groupedThreads.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-[var(--color-muted)]">
                No tutor chats yet.
              </p>
            ) : (
              groupedThreads.map((group) => (
                <section key={group.title} className="mb-2 last:mb-0">
                  <h4 className="px-2 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
                    {group.title}
                  </h4>
                  {group.threads.map((thread) => (
                    <div
                      key={thread.id}
                      className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 ${
                        thread.id === activeThreadId
                          ? "bg-[var(--color-accent-soft)]"
                          : "hover:bg-[var(--color-hover)]"
                      }`}
                    >
                      {renamingThreadId === thread.id ? (
                        <form
                          onSubmit={(event) => void handleRenameThread(event)}
                          className="flex min-w-0 flex-1 items-center gap-1"
                        >
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(event) =>
                              setRenameValue(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                setRenamingThreadId(null);
                                setRenameValue("");
                              }
                            }}
                            className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1 text-[11px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                            aria-label="Chat title"
                          />
                          <button
                            type="submit"
                            className="rounded p-1 text-[var(--color-accent)] hover:bg-[var(--color-panel)]"
                            aria-label="Save chat title"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => selectThread(thread)}
                            className="min-w-0 flex-1 truncate text-left text-[11px] text-[var(--color-ink)]"
                          >
                            {thread.title}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingThreadId(thread.id);
                              setRenameValue(thread.title);
                            }}
                            className="rounded p-1 text-[var(--color-muted)] opacity-0 transition hover:bg-[var(--color-panel)] hover:text-[var(--color-ink)] group-hover:opacity-100 focus:opacity-100"
                            title="Rename chat"
                            aria-label={`Rename ${thread.title}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void requestThreadDeletion(thread)}
                            disabled={preparingDeleteThreadId === thread.id}
                            className="rounded p-1 text-[var(--color-muted)] opacity-0 transition hover:bg-rose-50 hover:text-rose-700 group-hover:opacity-100 focus:opacity-100"
                            title="Delete chat"
                            aria-label={`Delete ${thread.title}`}
                          >
                            {preparingDeleteThreadId === thread.id ? (
                              <LoaderCircle className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        </AnimatedPresence>
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-panel-subtle)] p-4 select-text"
      >
        <div ref={topSentinelRef} className="h-px" />
        {isLoadingOlder && (
          <div
            aria-live="polite"
            className="sticky top-1 z-10 mx-auto -mb-6 flex h-6 w-fit items-center rounded-full border border-[var(--color-border)] bg-[var(--color-panel)] px-3 text-[10px] text-[var(--color-muted)] shadow-sm"
          >
            Loading earlier messages…
          </div>
        )}
        {isLoadingThread ? (
          <div className="flex h-full items-center justify-center">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-4 text-xs leading-5 text-[var(--color-muted)]">
            Ask about a concept or your notes.
          </div>
        ) : (
          messages.map((message, index) => (
            <TutorMessageBubble
              key={message.id}
              message={message}
              isActiveStream={
                isSending && index === messages.length - 1
              }
            />
          ))
        )}
        <div />
      </div>

      <div className="border-t border-[var(--color-border)] bg-[var(--color-panel)] p-3">
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <button
            type="button"
            disabled={!availableLesson}
            onClick={() => {
              if (!availableLesson) return;
              void updateAttachedLesson(
                attachedLesson?.id === availableLesson.id
                  ? null
                  : availableLesson
              );
            }}
            title={
              activeLesson
                ? `Attach ${activeLesson.title} to this chat`
                : "Open a lesson node first"
            }
            className="flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BookOpen className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {activeLesson
                ? `+ Lesson Context: ${activeLesson.title}`
                : "+ Lesson Context"}
            </span>
          </button>
          {attachedLesson && (
            <span className="flex min-w-0 items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-2 py-1 text-[9px] text-[var(--color-ink)]">
              <span className="shrink-0 text-[var(--color-muted)]">
                Attached:
              </span>
              <span className="truncate">{attachedLesson.title}</span>
              <button
                type="button"
                onClick={() => void updateAttachedLesson(null)}
                className="shrink-0 rounded-full p-0.5 hover:bg-[var(--color-panel)]"
                aria-label={`Remove ${attachedLesson.title} context`}
                title="Remove lesson context"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
        <form onSubmit={(event) => void handleSend(event)} className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask about this concept..."
            disabled={isLoadingThread}
            aria-label="Ask about this concept"
            className="min-h-[40px] max-h-[124px] min-w-0 flex-1 resize-none select-text rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-subtle)] px-3 py-2.5 text-xs leading-5 text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)] disabled:opacity-60"
          />
          {isSending ? (
            <button
              type="button"
              onClick={stopGeneration}
              className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-rose-700 transition hover:bg-rose-100"
              aria-label="Stop response"
              title="Stop response"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || isLoadingThread}
              className="rounded-lg bg-[var(--color-accent-button)] p-2.5 text-white transition hover:brightness-95 disabled:opacity-50"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </form>
        {payloadMetrics && (
          <div
            className="mt-1.5 text-right font-mono text-[9px] text-[var(--color-muted)]"
            aria-label={`Tutor prompt uses about ${payloadMetrics.totalTokens} tokens, ${payloadMetrics.savedPercent}% saved`}
          >
            ~{payloadMetrics.totalTokens} tok · {payloadMetrics.savedPercent}% saved
          </div>
        )}
      </div>
      {isOpen && deleteConfirmation && (
        <ConfirmDeleteModal
          title={
            deleteConfirmation.kind === "thread"
              ? "Delete tutor chat?"
              : "Clear chat history?"
          }
          itemName={
            deleteConfirmation.kind === "thread"
              ? deleteConfirmation.thread.title
              : deleteConfirmation.threadTitle
          }
          description={
            deleteConfirmation.kind === "thread"
              ? "The tutor chat and its entire saved message history will be permanently deleted."
              : "All messages and the saved conversation summary will be permanently cleared. The chat itself will remain."
          }
          impactItems={[
            { label: "Messages", value: deleteConfirmation.messageCount },
          ]}
          deleteLabel={
            deleteConfirmation.kind === "thread" ? "Delete chat" : "Clear history"
          }
          onCancel={() => setDeleteConfirmation(null)}
          onConfirm={() =>
            deleteConfirmation.kind === "thread"
              ? handleDeleteThread(deleteConfirmation.thread)
              : handleClearChat(deleteConfirmation.threadId)
          }
          onError={(error) =>
            onToast(
              `Unable to ${
                deleteConfirmation.kind === "thread" ? "delete tutor chat" : "clear tutor chat"
              }: ${errorMessage(error)}`
            )
          }
        />
      )}
    </aside>
  );
}
