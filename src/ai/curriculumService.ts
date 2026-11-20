import {
  generateGeminiText,
  parseGeminiJson,
  parseOrRepairGeminiJson,
  streamGeminiText,
  type GeminiRequestOptions,
} from "./geminiClient";
import { loadAiSettings } from "./keyStore";
import {
  buildTutorPayload,
  minifyContextText,
  type TutorPayload,
} from "./tokenOptimizer";
import { searchVaultFts } from "../db/repositories/documentRepo";
import { createWorkspace } from "../db/repositories/workspaceRepo";
import {
  hydrateNodeBatch,
  saveGraphBatch,
} from "../db/repositories/graphRepo";
import {
  buildInitialGraphNodes,
  validateAndLayerDag,
  type SkeletonEdgeInput,
  type SkeletonNodeInput,
} from "../engine/dagTopology";
import { computeSugiyamaLayout } from "../engine/sugiyamaLayout";
import type {
  Flashcard,
  GraphEdge,
  GraphNode,
  Workspace,
} from "../types/domain";
import {
  loadTutorMessagesForSummary,
  updateTutorRollingSummary,
  type TutorLessonContext,
  type TutorMessageCursor,
  type TutorThread,
} from "../db/repositories/tutorRepo";

interface CompactCurriculumResponse {
  t: string;
  d: string;
  n: Array<{ id: string; t: string; h: string }>;
  e: Array<[string, string]>;
}

interface RawCurriculumResponse {
  workspace_title: string;
  root_domain: string;
  nodes: SkeletonNodeInput[];
  edges: SkeletonEdgeInput[];
}

interface RawHydrationResponse {
  lesson_markdown: string;
  mermaid_diagram: string;
  flashcards: Array<{ front: string; back: string }>;
}

function normalizeHydrationResponse(value: unknown): RawHydrationResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The generated lesson was not a JSON object.");
  }
  const response = value as Record<string, unknown>;
  const lessonMarkdown = response.lesson_markdown ?? response.markdown;
  const mermaidDiagram = response.mermaid_diagram ?? response.mermaid ?? "";
  const flashcards = response.flashcards ?? [];
  if (
    typeof lessonMarkdown !== "string" ||
    !lessonMarkdown.trim() ||
    typeof mermaidDiagram !== "string" ||
    !Array.isArray(flashcards) ||
    !flashcards.every(
      (card) =>
        card !== null &&
        typeof card === "object" &&
        typeof (card as Record<string, unknown>).front === "string" &&
        typeof (card as Record<string, unknown>).back === "string"
    )
  ) {
    throw new Error("The generated lesson did not match the lesson schema.");
  }
  return {
    lesson_markdown: lessonMarkdown,
    mermaid_diagram: mermaidDiagram,
    flashcards: flashcards as RawHydrationResponse["flashcards"],
  };
}

function isRawMarkdownLesson(text: string): boolean {
  return /^(?:#{1,6}\s|```(?:[\w+-]+)?(?:\s|$)|(?:[-*+]\s|\d+\.\s)|>\s)/.test(
    text.trim()
  );
}

const tutorSummaryInFlight = new Set<string>();

export interface CurriculumProgress {
  phase: string;
  nodeTitles: string[];
}

export async function summarizeTutorThread(
  thread: TutorThread
): Promise<void> {
  if (tutorSummaryInFlight.has(thread.id)) return;
  tutorSummaryInFlight.add(thread.id);
  try {
    const cursor: TutorMessageCursor | null =
      thread.summary_cursor_created_at !== null && thread.summary_cursor_id
        ? {
            createdAt: thread.summary_cursor_created_at,
            id: thread.summary_cursor_id,
          }
        : null;
    const batch = await loadTutorMessagesForSummary(thread.id, cursor);
    if (batch.length < (cursor ? 12 : 6)) return;

    const messages = batch
      .map(
        (message) =>
          `${message.role === "user" ? "Student" : "Tutor"}: ${minifyContextText(
            message.content
          ).slice(0, 600)}`
      )
      .join("\n");
    const summary = await generateGeminiText({
      tier: "fast",
      temperature: 0,
      maxOutputTokens: 180,
      systemInstruction:
        "Update a compact study-session memory. Preserve concepts learned, confusions, and unresolved questions. Return only the revised summary, at most 120 tokens.",
      userPrompt: `Existing memory:\n${thread.rolling_summary || "(none)"}\n\nNew messages:\n${messages}`,
    });
    const compactSummary = minifyContextText(summary).slice(0, 480).trim();
    const last = batch[batch.length - 1];
    await updateTutorRollingSummary(thread.id, compactSummary, {
      createdAt: last.created_at,
      id: last.id,
    });
  } finally {
    tutorSummaryInFlight.delete(thread.id);
  }
}

/**
 * Generates a full validated DAG curriculum from a prompt + local FTS5 vault context.
 */
export async function generateWorkspaceCurriculum(
  topicPrompt: string,
  onProgress?: (progress: CurriculumProgress) => void,
  signal?: AbortSignal
): Promise<{
  workspace: Workspace;
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  onProgress?.({ phase: "Searching your local vault…", nodeTitles: [] });
  const vaultHits = await searchVaultFts(topicPrompt, 6);
  if (signal?.aborted) {
    throw new DOMException("Curriculum generation stopped.", "AbortError");
  }
  const vaultContext =
    vaultHits.length > 0
      ? vaultHits
          .map(
            (h, i) =>
              `[Source ${i + 1}: ${h.file_name}${
                h.heading ? ` > ${h.heading}` : ""
              }]\n${h.content.slice(0, 900)}`
          )
          .join("\n\n---\n\n")
      : "No local vault documents matched; use authoritative foundational curriculum structure.";

  onProgress?.({ phase: "Drafting prerequisite structure…", nodeTitles: [] });
  let streamedText = "";
  let lastReportedTitles: string[] = [];
  const curriculumRequest: GeminiRequestOptions & {
    jsonSchema: Record<string, unknown>;
  } = {
    tier: "synthesis",
    systemInstruction:
      "Create a prerequisite-first DAG with 7-12 atomic concepts. Edges point prerequisite to dependent. Return only compact JSON with keys t,d,n,e. Node keys: id,t,h. Each edge is [sourceId,targetId]. Keep h under 12 words. No cycles or prose.",
    userPrompt: `Goal: ${topicPrompt}\nLocal excerpts:\n${vaultContext}`,
    maxOutputTokens: 2048,
    signal,
    jsonSchema: {
      type: "OBJECT",
      properties: {
        t: { type: "STRING" },
        d: { type: "STRING" },
        n: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              t: { type: "STRING" },
              h: { type: "STRING" },
            },
            required: ["id", "t", "h"],
          },
        },
        e: {
          type: "ARRAY",
          items: {
            type: "ARRAY",
            items: { type: "STRING" },
          },
        },
      },
      required: ["t", "d", "n", "e"],
    },
  };
  const rawText = await streamGeminiText(curriculumRequest, (chunk) => {
    streamedText += chunk;
    if (!chunk.includes("}")) return;
    const nodeTitles = extractCompletedNodeTitles(streamedText);
    if (
      nodeTitles.length !== lastReportedTitles.length ||
      nodeTitles.some((title, index) => title !== lastReportedTitles[index])
    ) {
      lastReportedTitles = nodeTitles;
      onProgress?.({
        phase: "Drafting prerequisite structure…",
        nodeTitles,
      });
    }
  });
  const compact = await parseOrRepairGeminiJson<CompactCurriculumResponse>(
    curriculumRequest,
    rawText
  );
  const raw = mapCompactCurriculum(compact);
  if (signal?.aborted) {
    throw new DOMException("Curriculum generation stopped.", "AbortError");
  }

  onProgress?.({
    phase: "Validating DAG and arranging layers…",
    nodeTitles: extractCompletedNodeTitles(rawText),
  });
  const workspaceId = crypto.randomUUID();
  const now = Date.now();

  // Remap short AI slugs (n1, n2) to globally unique UUIDs so workspaces never collide
  const idMap = new Map<string, string>();
  const remappedNodes: SkeletonNodeInput[] = raw.nodes.map((n) => {
    const uid = crypto.randomUUID();
    idMap.set(n.id, uid);
    return {
      id: uid,
      title: n.title,
      summary_hint: n.summary_hint,
    };
  });

  const remappedEdges: SkeletonEdgeInput[] = raw.edges
    .map((e) => ({
      source_id: idMap.get(e.source_id) ?? "",
      target_id: idMap.get(e.target_id) ?? "",
    }))
    .filter((e) => e.source_id && e.target_id);

  const validated = validateAndLayerDag(
    workspaceId,
    remappedNodes,
    remappedEdges
  );
  const initialNodes = buildInitialGraphNodes(
    workspaceId,
    remappedNodes,
    validated
  );
  const positionedNodes = computeSugiyamaLayout(
    initialNodes,
    validated.validEdges
  );

  const workspace: Workspace = {
    id: workspaceId,
    title: raw.workspace_title || topicPrompt.slice(0, 48),
    root_domain: raw.root_domain || "General",
    created_at: now,
    updated_at: now,
  };

  onProgress?.({
    phase: "Saving curriculum…",
    nodeTitles: positionedNodes.map((node) => node.title),
  });
  await createWorkspace(workspace);
  await saveGraphBatch(positionedNodes, validated.validEdges);
  onProgress?.({
    phase: "Curriculum ready",
    nodeTitles: positionedNodes.map((node) => node.title),
  });

  return {
    workspace,
    nodes: positionedNodes,
    edges: validated.validEdges,
  };
}

function extractCompletedNodeTitles(text: string): string[] {
  const nodesKey = text.indexOf('"n"');
  const arrayStart = nodesKey >= 0 ? text.indexOf("[", nodesKey) : -1;
  if (arrayStart < 0) return [];

  const titles: string[] = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = arrayStart + 1; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) objectStart = index;
      depth++;
    } else if (character === "}") {
      depth--;
      if (depth === 0 && objectStart >= 0) {
        try {
          const node = JSON.parse(text.slice(objectStart, index + 1)) as {
            t?: unknown;
          };
          if (typeof node.t === "string") titles.push(node.t);
        } catch {
          return titles;
        }

        objectStart = -1;
      }
    } else if (character === "]" && depth === 0) {
      break;
    }
  }
  return titles;
}

function mapCompactCurriculum(
  compact: CompactCurriculumResponse
): RawCurriculumResponse {
  if (
    !compact ||
    typeof compact.t !== "string" ||
    typeof compact.d !== "string" ||
    !Array.isArray(compact.n) ||
    !Array.isArray(compact.e)
  ) {
    throw new Error("The generated curriculum did not match the compact DAG schema.");
  }
  if (compact.n.length === 0) {
    throw new Error("The generated curriculum contains no concepts.");
  }

  const nodeIds = new Set<string>();
  const nodes = compact.n.map((node) => {
    if (
      !node ||
      typeof node.id !== "string" ||
      typeof node.t !== "string" ||
      typeof node.h !== "string" ||
      !node.id.trim() ||
      !node.t.trim() ||
      nodeIds.has(node.id)
    ) {
      throw new Error("The generated curriculum contains an invalid node.");
    }
    nodeIds.add(node.id);
    return { id: node.id, title: node.t, summary_hint: node.h };
  });
  const edges = compact.e.map((edge) => {
    if (
      !Array.isArray(edge) ||
      edge.length !== 2 ||
      typeof edge[0] !== "string" ||
      typeof edge[1] !== "string"
    ) {
      throw new Error("The generated curriculum contains an invalid edge.");
    }
    return { source_id: edge[0], target_id: edge[1] };
  });

  return {
    workspace_title: compact.t,
    root_domain: compact.d,
    nodes,
    edges,
  };
}

/**
 * Hydrates a single DAG node with a structured lesson, Mermaid diagram, and SM-2 flashcards.
 */
export async function hydrateNodeContent(
  node: GraphNode,
  workspaceTitle: string
): Promise<{
  lessonMarkdown: string;
  mermaidDiagram: string;
  citations: string[];
  flashcards: Flashcard[];
}> {
  const vaultHits = await searchVaultFts(
    `${node.title} ${node.summary_hint}`,
    5,
    node.workspace_id
  );
  const citations = Array.from(
    new Set(
      vaultHits.map((h) =>
        h.heading ? `${h.file_name} — ${h.heading}` : h.file_name
      )
    )
  );

  const vaultContext =
    vaultHits.length > 0
      ? vaultHits.map((h) => `[${h.file_name}] ${h.content}`).join("\n\n")
      : "No direct local file excerpts matched; provide rigorous first-principles instruction.";

  const hydrationRequest: GeminiRequestOptions & {
    jsonSchema: Record<string, unknown>;
  } = {
    tier: "synthesis",
    systemInstruction:
      "Teach from first principles in concise Markdown with examples and takeaways. Return exactly one JSON object matching the schema. Put lesson Markdown in lesson_markdown, valid Mermaid syntax without fences in mermaid_diagram, and 4 high-yield recall cards in flashcards. Do not return prose or code fences outside the JSON object.",
    userPrompt: `Course: ${workspaceTitle}\nTopic Node: ${node.title}\nScope: ${node.summary_hint}\n\nLocal Vault Context:\n${vaultContext}`,
    maxOutputTokens: 5500,
    jsonSchema: {
      type: "OBJECT",
      properties: {
        lesson_markdown: { type: "STRING" },
        mermaid_diagram: {
          type: "STRING",
          description: "Valid Mermaid graph TD or flowchart LR syntax only",
        },
        flashcards: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              front: { type: "STRING" },
              back: { type: "STRING" },
            },
            required: ["front", "back"],
          },
        },
      },
      required: ["lesson_markdown", "mermaid_diagram", "flashcards"],
    },
  };

  const firstText = await generateGeminiText(hydrationRequest);
  let raw: RawHydrationResponse;
  try {
    raw = normalizeHydrationResponse(parseGeminiJson<unknown>(firstText));
  } catch (initialError) {
    if (isRawMarkdownLesson(firstText)) {
      raw = normalizeHydrationResponse({
        markdown: firstText.trim(),
        mermaid: "",
        flashcards: [],
      });
    } else {
      let retryText = "";
      try {
        retryText = await generateGeminiText({
          ...hydrationRequest,
          temperature: 0,
          userPrompt: `${hydrationRequest.userPrompt}\n\nReturn the complete lesson as one valid JSON object matching the schema. Escape every backslash and quote inside string values.`,
        });
        raw = normalizeHydrationResponse(parseGeminiJson<unknown>(retryText));
      } catch (retryError) {
        const markdownFallback = [retryText, firstText].find(
          isRawMarkdownLesson
        );
        if (markdownFallback) {
          raw = normalizeHydrationResponse({
            markdown: markdownFallback.trim(),
            mermaid: "",
            flashcards: [],
          });
        } else {
          const detail =
            retryError instanceof Error
              ? retryError.message
              : initialError instanceof Error
                ? initialError.message
                : "Unknown response parsing error";
          throw new Error(
            `Lesson generation returned invalid structured content after one retry: ${detail}`
          );
        }
      }
    }
  }

  const now = Date.now();
  const cards: Flashcard[] = raw.flashcards.map((fc) => ({
    id: crypto.randomUUID(),
    node_id: node.id,
    front: fc.front,
    back: fc.back,
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    next_review_at: now,
  }));

  await hydrateNodeBatch(
    node.id,
    raw.lesson_markdown,
    raw.mermaid_diagram || null,
    JSON.stringify(citations),
    cards
  );

  return {
    lessonMarkdown: raw.lesson_markdown,
    mermaidDiagram: raw.mermaid_diagram,
    citations,
    flashcards: cards,
  };
}

/**
 * Grounded Socratic tutor chat grounded in local FTS5 vault chunks + active node context.
 */
export async function askGroundedTutor(
  userMessage: string,
  activeNodeTitle?: string,
  workspaceId?: string,
  options: {
    signal?: AbortSignal;
    onChunk?: (text: string) => void;
    onPayload?: (payload: Pick<TutorPayload, "totalTokens" | "savedPercent">) => void;
    lessonContext?: TutorLessonContext | null;
    rollingSummary?: string | null;
    history?: Array<{
      role: "user" | "assistant";
      content: string;
      attached_lesson_title?: string | null;
    }>;
  } = {}
): Promise<{
  reply: string;
  citations: string[];
  totalTokens: number;
  savedPercent: number;
}> {
  const hits = await searchVaultFts(
    `${activeNodeTitle ?? ""} ${userMessage}`
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 24)
      .join(" "),
    4,
    workspaceId
  );
  const citations = Array.from(new Set(hits.map((h) => h.file_name)));
  const lessonContext = options.lessonContext;
  const aiSettings = loadAiSettings();
  const outputTokenBudget =
    aiSettings.provider === "openai-compatible"
      ? Math.min(600, aiSettings.localMaxOutputTokens)
      : 1200;
  const payload = buildTutorPayload({
    provider: aiSettings.provider,
    localContextWindowTokens: aiSettings.localContextWindowTokens,
    outputTokenBudget,
    userMessage,
    activeNodeTitle,
    lessonTitle: lessonContext?.title,
    lessonSummary: lessonContext?.summaryHint,
    lessonLayer: lessonContext?.layerIndex,
    lessonMarkdown: lessonContext?.lessonMarkdown,
    vaultChunks: hits,
    history: options.history ?? [],
    rollingSummary: options.rollingSummary,
  });
  options.onPayload?.({
    totalTokens: payload.totalTokens,
    savedPercent: payload.savedPercent,
  });

  const reply = await streamGeminiText({
    tier: "fast",
    systemInstruction: payload.systemInstruction,
    userPrompt: payload.userPrompt,
    maxOutputTokens: outputTokenBudget,
    signal: options.signal,
  }, options.onChunk ?? (() => {}));

  return {
    reply,
    citations,
    totalTokens: payload.totalTokens,
    savedPercent: payload.savedPercent,
  };
}