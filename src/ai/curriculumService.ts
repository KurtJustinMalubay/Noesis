import {
  generateGeminiJson,
  generateGeminiText,
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
import {
  extractLessonImageRequest,
  isLessonImageTitleRelevant,
  replaceLessonImageRequest,
} from "./lessonImageMarkers";
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

const tutorSummaryInFlight = new Set<string>();

export interface CurriculumProgress {
  phase: string;
  nodeTitles: string[];
}

export interface CurriculumSourceDocument {
  name: string;
  text: string;
}

interface CommonsImage {
  title: string;
  imageUrl: string;
  sourceUrl: string;
  attribution: string;
}

interface CommonsSearchResult {
  image: CommonsImage | null;
  warning: string | null;
}

async function searchCommonsImage(
  query: string,
  signal?: AbortSignal
): Promise<CommonsImage | null> {
  const searchUrl = new URL("https://commons.wikimedia.org/w/api.php");
  searchUrl.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "5",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "1200",
    format: "json",
    origin: "*",
  }).toString();
  const controller = new AbortController();
  const abortSearch = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortSearch, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Wikimedia Commons returned HTTP ${response.status}.`);
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return null;
    const queryData = (payload as Record<string, unknown>).query;
    if (!queryData || typeof queryData !== "object") return null;
    const pages = (queryData as Record<string, unknown>).pages;
    if (!pages || typeof pages !== "object") return null;
    for (const candidate of Object.values(pages as Record<string, unknown>)) {
      if (!candidate || typeof candidate !== "object") continue;
      const page = candidate as Record<string, unknown>;
      if (typeof page.title !== "string") continue;
      const title = page.title.replace(/^File:/i, "");
      if (!isLessonImageTitleRelevant(query, title)) continue;

      const imageInfo = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if (!imageInfo || typeof imageInfo !== "object") continue;
      const info = imageInfo as Record<string, unknown>;
      if (
        typeof info.thumburl !== "string" ||
        typeof info.descriptionurl !== "string"
      ) {
        continue;
      }
      const imageUrl = new URL(info.thumburl);
      const sourceUrl = new URL(info.descriptionurl);
      if (imageUrl.protocol !== "https:" || sourceUrl.protocol !== "https:") {
        continue;
      }
      const metadata =
        info.extmetadata && typeof info.extmetadata === "object"
          ? (info.extmetadata as Record<
              string,
              { value?: unknown; shortName?: unknown }
            >)
          : {};
      const creator =
        typeof metadata.Artist?.value === "string"
          ? metadata.Artist.value.replace(/<[^>]*>/g, "").trim()
          : "";
      const license =
        typeof metadata.LicenseShortName?.value === "string"
          ? metadata.LicenseShortName.value.trim()
          : "";
      return {
        title,
        imageUrl: imageUrl.toString(),
        sourceUrl: sourceUrl.toString(),
        attribution: `${title}${creator ? ` — ${creator}` : ""}${
          license ? ` (${license})` : ""
        }`,
      };
    }
    return null;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortSearch);
  }
}

async function searchCommonsImageSafely(
  query: string,
  signal?: AbortSignal
): Promise<CommonsSearchResult> {
  try {
    return { image: await searchCommonsImage(query, signal), warning: null };
  } catch {
    return {
      image: null,
      warning: "Online image search was unavailable; generated content has no image.",
    };
  }
}

function insertLessonImage(
  markdown: string,
  image: CommonsImage,
  includeAttribution = false
): string {
  const imageMarkdown = formatLessonImage(image, includeAttribution);
  const headingMatch = markdown.match(/^#{1,2}\s+.+(?:\r?\n|$)/);
  if (!headingMatch) return `${imageMarkdown}\n\n${markdown}`;
  const headingEnd = headingMatch[0].length;
  return `${markdown.slice(0, headingEnd)}\n${imageMarkdown}\n\n${markdown.slice(
    headingEnd
  )}`;
}

function formatLessonImage(
  image: CommonsImage,
  includeAttribution = false
): string {
  const alt = image.title.replace(/[\[\]\r\n]/g, " ").trim();
  const url = image.imageUrl.replace(/[()]/g, (character) =>
    character === "(" ? "%28" : "%29"
  );
  const attribution = image.attribution.replace(
    /([\\`*_{}\[\]()#+.!|>~-])/g,
    "\\$1"
  );
  const sourceUrl = image.sourceUrl.replace(/\)/g, "%29");
  const imageMarkdown = `![${alt}](${url})${
    includeAttribution
      ? `\n\n*Image: [${attribution}](<${sourceUrl}>) · Wikimedia Commons*`
      : ""
  }`;
  return imageMarkdown;
}

export type WorkedExampleTool =
  | "mermaid"
  | "math"
  | "code"
  | "trace-table"
  | "analogy"
  | "image";

export async function generateWorkedExample(
  node: GraphNode,
  userPrompt: string,
  tools: WorkedExampleTool[],
  options: {
    signal?: AbortSignal;
    onChunk?: (text: string) => void;
  } = {}
): Promise<string> {
  const vaultHits = await searchVaultFts(
    `${node.title} ${node.summary_hint} ${userPrompt}`,
    5,
    node.workspace_id
  );
  const vaultContext = vaultHits.length
    ? vaultHits.map((hit) => `[${hit.file_name}] ${hit.content}`).join("\n\n")
    : "No matching local vault excerpts.";
  const toolInstructions: Record<WorkedExampleTool, string> = {
    mermaid:
      "Include a valid Mermaid fenced code block (stateDiagram-v2, flowchart TD, sequenceDiagram, or graph) for an appropriate diagram.",
    math: String.raw`Show complete step-by-step equations with KaTeX-compatible \frac{numerator}{denominator} syntax; never use \over.`,
    code: "Include a commented code walkthrough and a sample input/output trace.",
    "trace-table": "Include a Markdown state or execution trace table.",
    analogy: "Include a concise real-world analogy and explain where it does and does not apply.",
    image:
      "A relevant online Wikimedia Commons illustration will be added when one is available; do not claim details about an image you cannot see.",
  };
  const selectedInstructions = tools.length
    ? tools.map((tool) => toolInstructions[tool]).join("\n")
    : "Choose the most useful worked-example format for this concept.";
  const imageResultPromise = tools.includes("image")
    ? searchCommonsImageSafely(
      `${node.title} ${userPrompt.split(/\s+/).slice(0, 6).join(" ")}`,
      options.signal
      )
    : Promise.resolve({ image: null, warning: null });
  const generatedExample = await streamGeminiText(
    {
      tier: "synthesis",
      systemInstruction:
        "Generate one self-contained worked example to append to the existing lesson. Use clear Markdown headings, explain each step, and remain grounded in the concept and provided sources. Use \\frac{numerator}{denominator} for fractions and never use TeX \\over. Do not repeat the whole lesson.",
      userPrompt: `Concept: ${node.title}\nSummary: ${node.summary_hint}\nLearner focus: ${userPrompt || "Choose a representative example."}\nRequested tools:\n${selectedInstructions}\n\nExisting lesson:\n${node.lesson_markdown ?? ""}\n\nLocal vault excerpts:\n${vaultContext}`,
      maxOutputTokens: 3072,
      signal: options.signal,
    },
    options.onChunk ?? (() => {})
  );
  if (!tools.includes("image")) return generatedExample;
  const imageResult = await imageResultPromise;
  if (imageResult.image) {
    return insertLessonImage(generatedExample, imageResult.image, true);
  }
  if (imageResult.warning) {
    return `${generatedExample}\n\n> ${imageResult.warning}`;
  }
  return generatedExample;
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
  signal?: AbortSignal,
  sourceDocument?: CurriculumSourceDocument
): Promise<{
  workspace: Workspace;
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  onProgress?.({
    phase: sourceDocument
      ? "Reading uploaded course document…"
      : "Searching your local vault…",
    nodeTitles: [],
  });
  const vaultHits = sourceDocument
    ? []
    : await searchVaultFts(topicPrompt, 6);
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
  const sourceText = sourceDocument
    ? minifyContextText(sourceDocument.text)
    : "";
  const sourceContext =
    sourceText.length > 10_000
      ? `${sourceText.slice(0, 10_000).trimEnd()}\n[Document excerpt truncated]`
      : sourceText;

  onProgress?.({ phase: "Drafting prerequisite structure…", nodeTitles: [] });
  let streamedText = "";
  let lastReportedTitles: string[] = [];
  const curriculumRequest: GeminiRequestOptions & {
    jsonSchema: Record<string, unknown>;
  } = {
    tier: "synthesis",
    systemInstruction:
      sourceDocument
        ? "Create a prerequisite-first DAG based on the uploaded course document. Use its course scope, stated sequence, learning outcomes, and topics as the primary source; add only necessary prerequisites. Create 7-12 atomic concepts. Edges point prerequisite to dependent. Return only compact JSON with keys t,d,n,e. Node keys: id,t,h. Each edge is [sourceId,targetId]. Keep h under 12 words. No cycles or prose."
        : "Create a prerequisite-first DAG with 7-12 atomic concepts. Edges point prerequisite to dependent. Return only compact JSON with keys t,d,n,e. Node keys: id,t,h. Each edge is [sourceId,targetId]. Keep h under 12 words. No cycles or prose.",
    userPrompt: sourceDocument
      ? `Goal: ${topicPrompt}\nUploaded course document: ${sourceDocument.name}\nDocument text:\n${sourceContext}`
      : `Goal: ${topicPrompt}\nLocal excerpts:\n${vaultContext}`,
    maxOutputTokens: 2048,
    timeoutMs: 120_000,
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
    layout_mode: "auto",
    created_at: now,
    updated_at: now,
    archived_at: null,
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
  value: unknown
): RawCurriculumResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The generated curriculum did not match the compact DAG schema.");
  }
  const compact = value as Record<string, unknown>;
  const rawNodes = Array.isArray(compact.n) ? compact.n : [];
  if (rawNodes.length === 0) {
    throw new Error("The generated curriculum contains no concepts.");
  }

  const nodeIds = new Set<string>();
  const nodes = rawNodes.map((rawNode, index) => {
    const node =
      rawNode && typeof rawNode === "object" && !Array.isArray(rawNode)
        ? (rawNode as Record<string, unknown>)
        : {};
    let id =
      typeof node.id === "string" && node.id.trim()
        ? node.id.trim()
        : `concept-${index + 1}`;
    while (nodeIds.has(id)) id = `concept-${index + 1}-${nodeIds.size + 1}`;
    nodeIds.add(id);
    const title =
      typeof node.t === "string" && node.t.trim()
        ? node.t.trim()
        : `Concept ${index + 1}`;
    const summary =
      typeof node.h === "string" && node.h.trim()
        ? node.h.trim()
        : `Core knowledge and skills for ${title}.`;
    return { id, title, summary_hint: summary };
  });
  const edges = (Array.isArray(compact.e) ? compact.e : []).flatMap((edge) => {
    if (
      !Array.isArray(edge) ||
      edge.length !== 2 ||
      typeof edge[0] !== "string" ||
      typeof edge[1] !== "string" ||
      !nodeIds.has(edge[0]) ||
      !nodeIds.has(edge[1]) ||
      edge[0] === edge[1]
    ) {
      return [];
    }
    return [{ source_id: edge[0], target_id: edge[1] }];
  });

  return {
    workspace_title:
      typeof compact.t === "string" && compact.t.trim()
        ? compact.t.trim()
        : "Learning curriculum",
    root_domain:
      typeof compact.d === "string" && compact.d.trim()
        ? compact.d.trim()
        : "General",
    nodes,
    edges,
  };
}

export async function generateLessonMaterial(
  node: GraphNode,
  workspaceTitle: string
): Promise<{
  lessonMarkdown: string;
  mermaidDiagram: string;
  citations: string[];
}> {
  const lessonDepth = loadAiSettings().lessonDepth;
  const lessonDepthInstructions = {
    concise:
      "Write approximately 450–650 words. Focus on core intuition, a formal definition, and one worked example.",
    standard:
      "Write approximately 1,000–1,500 words with structured sections, intuition, formal mechanics, two worked examples, and takeaways.",
    comprehensive:
      "Write approximately 2,000–3,200+ words with motivation, formal definitions or theorems, step-by-step derivations, multiple worked examples, edge cases, common pitfalls, and a summary.",
  }[lessonDepth];
  const lessonTokenBudgets = {
    concise: 1536,
    standard: 3584,
    comprehensive: 8192,
  } as const;
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

  const lessonRequest: GeminiRequestOptions = {
    tier: "synthesis",
    systemInstruction:
      `Teach from first principles. ${lessonDepthInstructions} Use \\frac{numerator}{denominator} for every fraction and never use TeX \\over. Return the complete lesson as raw Markdown only, with clear headings, worked examples, and one valid Mermaid flowchart in a fenced mermaid block. Use simple alphanumeric node IDs and quote node labels. Do not wrap the lesson in JSON. Only request an online image when a specific real-world visual materially helps explain a concept; never add a decorative image or image to the opening just to fill space. When one is useful, put [[NOESIS_IMAGE: concise specific subject]] on its own line at the point in the lesson where it is discussed. Request at most one image, and do not request an image for a concept that is better explained by the diagram or equations.`,
    userPrompt: `Course: ${workspaceTitle}\nTopic Node: ${node.title}\nScope: ${node.summary_hint}\n\nLocal Vault Context:\n${vaultContext}`,
    maxOutputTokens: lessonTokenBudgets[lessonDepth],
  };
  const generatedLesson = (await generateGeminiText(lessonRequest)).trim();
  if (!generatedLesson) {
    throw new Error(`Lesson generation returned empty content for ${node.title}.`);
  }

  const mermaidMatch = generatedLesson.match(
    /```mermaid\s*\r?\n([\s\S]*?)```/i
  );
  let mermaidDiagram = mermaidMatch?.[1]?.trim() ?? "";
  let lessonMarkdown = mermaidMatch
    ? generatedLesson.replace(mermaidMatch[0], "").trim()
    : generatedLesson;
  const imageRequest = extractLessonImageRequest(lessonMarkdown);
  const imageResultPromise = imageRequest
    ? searchCommonsImageSafely(imageRequest.query)
    : Promise.resolve({ image: null, warning: null });
  if (!mermaidDiagram) {
    try {
      const diagramResponse = await generateGeminiText({
        tier: "fast",
        temperature: 0.1,
        maxOutputTokens: 400,
        timeoutMs: 45_000,
        systemInstruction:
          "Return only a valid Mermaid flowchart using flowchart TD. Use simple alphanumeric node IDs, quote every node label, and connect 3-6 key ideas. No markdown fences or prose.",
        userPrompt: `Create a concept diagram for "${node.title}". Scope: ${node.summary_hint}\nLesson:\n${lessonMarkdown.slice(0, 2500)}`,
      });
      mermaidDiagram = diagramResponse
        .replace(/^```(?:mermaid)?\s*/i, "")
        .replace(/```$/g, "")
        .trim();
    } catch (error) {
      citations.push(
        `Concept diagram generation was unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  if (imageRequest) {
    const imageResult = await imageResultPromise;
    lessonMarkdown = replaceLessonImageRequest(
      lessonMarkdown,
      imageRequest.marker,
      imageResult.image ? formatLessonImage(imageResult.image) : ""
    );
    if (imageResult.image) {
      citations.push(
        `Illustration: ${imageResult.image.attribution} — ${imageResult.image.sourceUrl}`
      );
    } else if (imageResult.warning) {
      citations.push(imageResult.warning);
    }
  }
  return {
    lessonMarkdown,
    mermaidDiagram,
    citations,
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
  const { lessonMarkdown, mermaidDiagram, citations } =
    await generateLessonMaterial(node, workspaceTitle);
  const flashcardSchema: Record<string, unknown> = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        front: { type: "STRING" },
        back: { type: "STRING" },
      },
      required: ["front", "back"],
    },
  };
  const rawFlashcards = await generateGeminiJson<unknown>({
    tier: "fast",
    temperature: 0,
    maxOutputTokens: 700,
    systemInstruction:
      "Generate four concise, high-yield recall flashcards from the lesson. Return a flat JSON array of objects with string front and back fields only.",
    userPrompt: `Concept: ${node.title}\nScope: ${node.summary_hint}\nLesson:\n${lessonMarkdown.slice(0, 9000)}`,
    jsonSchema: flashcardSchema,
  });
  if (!Array.isArray(rawFlashcards)) {
    throw new Error(`Flashcard generation returned an invalid array for ${node.title}.`);
  }
  const normalizedFlashcards = rawFlashcards.slice(0, 5).map((value) => {
    const card =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return {
      front:
        typeof card.front === "string" && card.front.trim()
          ? card.front.trim()
          : `What is an important idea in ${node.title}?`,
      back:
        typeof card.back === "string" && card.back.trim()
          ? card.back.trim()
          : node.summary_hint,
    };
  });
  while (normalizedFlashcards.length < 3) {
    normalizedFlashcards.push({
      front: `What is an important idea in ${node.title}?`,
      back: node.summary_hint,
    });
  }

  const now = Date.now();
  const cards: Flashcard[] = normalizedFlashcards.map((fc) => ({
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
    lessonMarkdown,
    mermaidDiagram || null,
    JSON.stringify(citations),
    cards
  );

  return {
    lessonMarkdown,
    mermaidDiagram,
    citations,
    flashcards: cards,
  };
}

/**
 * Context-aware tutor or assistant chat grounded in local sources and lesson context.
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
    interactionStyle?: "tutor" | "assistant";
    rollingSummary?: string | null;
    history?: Array<{
      role: "user" | "assistant";
      content: string;
      attached_lesson_title?: string | null;
    }>;
    askFollowUpQuestions?: boolean;
    preferConciseReplies?: boolean;
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
    interactionStyle: options.interactionStyle,
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
    systemInstruction: `${payload.systemInstruction}\nFor mathematical fractions, use \\frac{numerator}{denominator}; never use TeX \\over.${
      options.askFollowUpQuestions === false
        ? "\nDo not end replies with follow-up questions or invitations to continue unless clarification is essential."
        : ""
    }${
      options.preferConciseReplies
        ? "\nPrefer concise, direct replies and avoid unnecessary detail."
        : ""
    }`,
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