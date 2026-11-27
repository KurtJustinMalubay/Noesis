import type { AiProvider } from "./keyStore.ts";

export interface ProviderBudget {
  total: number;
  lesson: number;
  vault: number;
  history: number;
  system: number;
}

export interface TutorContextMessage {
  role: "user" | "assistant";
  content: string;
  attached_lesson_title?: string | null;
}

export interface TutorPayloadInput {
  provider: AiProvider;
  interactionStyle?: "tutor" | "assistant";
  localContextWindowTokens?: number;
  outputTokenBudget?: number;
  userMessage: string;
  activeNodeTitle?: string;
  lessonTitle?: string;
  lessonSummary?: string;
  lessonLayer?: number;
  lessonMarkdown?: string | null;
  dashboardContext?: string | null;
  vaultChunks: Array<{
    file_name: string;
    heading?: string | null;
    content: string;
  }>;
  history: TutorContextMessage[];
  rollingSummary?: string | null;
}

export interface TutorPayload {
  systemInstruction: string;
  userPrompt: string;
  totalTokens: number;
  savedPercent: number;
}

interface LessonSection {
  heading: string;
  body: string;
  index: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function allocateLocalBudget(total: number): ProviderBudget {
  const lesson = Math.floor((total * 450) / 1400);
  const vault = Math.floor((total * 350) / 1400);
  const history = Math.floor((total * 450) / 1400);
  return {
    total,
    lesson,
    vault,
    history,
    system: Math.max(0, total - lesson - vault - history),
  };
}

export function getProviderBudget(
  provider: AiProvider,
  localContextWindowTokens = 2048,
  localOutputTokenBudget = 600
): ProviderBudget {
  if (provider === "gemini") {
    return { total: 4000, lesson: 1200, vault: 1000, history: 1400, system: 400 };
  }
  return allocateLocalBudget(
    Math.max(1, localContextWindowTokens - localOutputTokenBudget - 128)
  );
}

export function minifyContextText(text: string): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  let inHtmlComment = false;
  let previousWasBlank = false;

  for (const sourceLine of lines) {
    const fence = sourceLine.match(/^\s*(```+|~~~+)/);
    if (fence && (!inFence || fence[1].startsWith(fenceMarker))) {
      inFence = !inFence;
      fenceMarker = inFence ? fence[1] : "";
      output.push(sourceLine);
      previousWasBlank = false;
      continue;
    }

    if (inFence) {
      output.push(sourceLine);
      continue;
    }

    let line = "";
    for (let index = 0; index < sourceLine.length; ) {
      if (inHtmlComment) {
        const end = sourceLine.indexOf("-->", index);
        if (end < 0) break;
        inHtmlComment = false;
        index = end + 3;
      } else {
        const start = sourceLine.indexOf("<!--", index);
        if (start < 0) {
          line += sourceLine.slice(index);
          break;
        }
        line += sourceLine.slice(index, start);
        const end = sourceLine.indexOf("-->", start + 4);
        if (end < 0) {
          inHtmlComment = true;
          break;
        }
        index = end + 3;
      }
    }

    const preserveLine = line.includes("$") || line.includes("\\(") || line.includes("\\[");
    const normalized = preserveLine ? line : line.trimEnd();
    const isBlank = normalized.trim().length === 0;
    if (isBlank && previousWasBlank) continue;
    output.push(normalized);
    previousWasBlank = isBlank;
  }

  return output.join("\n").trim();
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_\\$.-]+/gu) ?? [];
}

function truncateAtParagraphBoundary(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return "";
  const normalized = minifyContextText(text);
  if (estimateTokens(normalized) <= maxTokens) return normalized;

  const maxChars = maxTokens * 4;
  const candidate = normalized.slice(0, maxChars);
  const boundary = candidate.lastIndexOf("\n\n");
  if (boundary > maxChars * 0.45) return candidate.slice(0, boundary).trim();
  const lastSpace = candidate.lastIndexOf(" ");
  return candidate.slice(0, lastSpace > 0 ? lastSpace : maxChars).trimEnd();
}

function splitLessonSections(markdown: string): LessonSection[] {
  const sections: LessonSection[] = [];
  let heading = "Overview";
  let body: string[] = [];

  const flush = () => {
    sections.push({
      heading,
      body: body.join("\n").trim(),
      index: sections.length,
    });
    body = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^#{2,3}\s+(.+?)\s*#*\s*$/);
    if (match) {
      flush();
      heading = match[1];
    } else {
      body.push(line);
    }
  }
  flush();
  return sections.filter((section) => section.heading !== "Overview" || section.body);
}

function buildLessonSkeleton(sections: LessonSection[]): string {
  const headings = sections.map((section) => `- ${section.heading}`);
  const takeaways: string[] = [];
  let inTakeaways = false;

  for (const section of sections) {
    inTakeaways = /key takeaways/i.test(section.heading);
    if (!inTakeaways) continue;
    for (const line of section.body.split(/\r?\n/)) {
      if (/^\s*[-*+]\s+/.test(line)) takeaways.push(line.trim());
    }
  }

  const skeleton = [
    "Lesson outline:",
    ...headings,
    ...(takeaways.length ? ["Key takeaways:", ...takeaways] : []),
  ].join("\n");
  return truncateAtParagraphBoundary(skeleton, 180);
}

function scoreSection(
  section: LessonSection,
  queryTerms: Set<string>,
  queryTermCount: number
): number {
  if (queryTermCount === 0) return 0;
  const bodyTerms = tokenize(section.body);
  const headingTerms = new Set(tokenize(section.heading));
  const frequencies = new Map<string, number>();
  for (const term of bodyTerms) {
    frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }

  let overlap = 0;
  let exactMatches = 0;
  for (const term of frequencies.keys()) {
    if (!queryTerms.has(term)) continue;
    overlap += 1;
    if (term.includes("$") || term.includes("\\") || term.includes("_")) {
      exactMatches += 1;
    }
  }
  let headingMatches = 0;
  for (const term of headingTerms) {
    if (queryTerms.has(term)) headingMatches += 1;
  }
  return (
    overlap / queryTermCount +
    headingMatches * 2 +
    exactMatches * 1.5
  );
}

export function extractRelevantLessonContext(
  lessonMarkdown: string,
  userQuery: string,
  maxTokens = 900,
  options: { lessonTitle?: string; omitRepeatedBoilerplate?: boolean } = {}
): string {
  const sections = splitLessonSections(minifyContextText(lessonMarkdown));
  if (sections.length === 0) return "";
  const skeleton = buildLessonSkeleton(sections);
  const queryTerms = new Set(tokenize(userQuery));
  const topSections: Array<{ section: LessonSection; score: number }> = [];
  const topCount = options.omitRepeatedBoilerplate ? 1 : 2;
  for (const section of sections) {
    const score = scoreSection(section, queryTerms, queryTerms.size);
    if (score <= 0) continue;
    const insertAt = topSections.findIndex((entry) => score > entry.score);
    if (insertAt < 0) {
      if (topSections.length < topCount) topSections.push({ section, score });
    } else {
      topSections.splice(insertAt, 0, { section, score });
      if (topSections.length > topCount) topSections.pop();
    }
  }
  const selected =
    topSections.length > 0
      ? topSections.map(({ section }) => section)
      : sections.slice(0, 1);

  const title = options.lessonTitle ? `Lesson: ${options.lessonTitle}\n` : "";
  const outline = options.omitRepeatedBoilerplate ? skeleton : `${title}${skeleton}`;
  let result = truncateAtParagraphBoundary(outline, Math.min(180, maxTokens));
  let remaining = maxTokens - estimateTokens(result);

  for (const section of selected) {
    if (remaining <= 0) break;
    const sectionText = `\n\n## ${section.heading}\n${section.body}`;
    const packed = truncateAtParagraphBoundary(sectionText, remaining);
    if (!packed) continue;
    result = `${result}${packed}`;
    remaining = maxTokens - estimateTokens(result);
    if (estimateTokens(packed) < estimateTokens(sectionText)) break;
  }
  return result.trim();
}

export function compressTutorHistory(
  history: TutorContextMessage[],
  rollingSummary = ""
): { recentMessages: TutorContextMessage[]; summary: string } {
  return {
    recentMessages: history.filter((message) => message.content).slice(-6),
    summary: truncateAtParagraphBoundary(minifyContextText(rollingSummary), 120),
  };
}

export function buildTutorPayload(input: TutorPayloadInput): TutorPayload {
  const budget = getProviderBudget(
    input.provider,
    input.localContextWindowTokens,
    input.outputTokenBudget
  );
  const historyDedupWindow = input.history.slice(-6);
  const repeatedLesson = Boolean(
    input.lessonTitle &&
      historyDedupWindow.some(
        (message) => message.attached_lesson_title === input.lessonTitle
      )
  );
  const lessonMeta = input.lessonTitle && !repeatedLesson
      ? [
          `Title: ${input.lessonTitle}`,
          input.lessonLayer === undefined
            ? ""
            : `Layer: ${input.lessonLayer + 1}`,
          input.lessonSummary
            ? `Summary: ${input.lessonSummary}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";
  const lesson = input.lessonMarkdown
    ? extractRelevantLessonContext(
        input.lessonMarkdown,
        input.userMessage,
          Math.max(1, budget.lesson - estimateTokens(lessonMeta) - 4),
        {
          lessonTitle: input.lessonTitle,
          omitRepeatedBoilerplate: repeatedLesson,
        }
      )
    : "";
  const dashboardSummary =
    !lessonMeta && !lesson && input.dashboardContext
      ? truncateAtParagraphBoundary(
          minifyContextText(input.dashboardContext),
          budget.lesson
        )
      : "";
  const lessonContext = [lessonMeta, lesson, dashboardSummary]
    .filter(Boolean)
    .join("\n");
  const vaultParts: string[] = [];
  let vaultTokens = 0;
  for (const chunk of input.vaultChunks) {
    if (vaultTokens >= budget.vault) break;
    const header = `[${chunk.file_name}${chunk.heading ? ` > ${chunk.heading}` : ""}]`;
    const remaining = budget.vault - vaultTokens - estimateTokens(header);
    if (remaining <= 0) break;
    const content = truncateAtParagraphBoundary(chunk.content, remaining);
    if (!content) continue;
    const part = `${header} ${content}`;
    vaultParts.push(part);
    vaultTokens += estimateTokens(part);
  }

  const { recentMessages, summary } = compressTutorHistory(
    input.history,
    input.rollingSummary ?? ""
  );
  const historyParts: string[] = [];
  let historyTokens = 0;
  if (summary) {
    const summaryPart = `Earlier study summary: ${summary}`;
    historyParts.push(summaryPart);
    historyTokens = estimateTokens(summaryPart);
  }
  for (const message of [...recentMessages].reverse()) {
    const prefix =
      message.role === "user"
        ? "Student: "
        : input.interactionStyle === "assistant"
          ? "Assistant: "
          : "Tutor: ";
    const remaining =
      budget.history - historyTokens - estimateTokens(prefix);
    if (remaining <= 0) break;
    const content = truncateAtParagraphBoundary(message.content, remaining);
    if (!content) continue;
    const part = `${prefix}${content}`;
    historyParts.unshift(part);
    historyTokens += estimateTokens(part);
  }

  const systemInstruction = minifyContextText(
    input.interactionStyle === "assistant"
      ? "Be a helpful AI assistant. Answer the user's request directly and naturally; explain reasoning when useful. Use the attached lesson and local sources as context without forcing a tutoring or Socratic style."
      : "Be a concise Socratic study partner. Guide first-principles understanding and ground answers in the attached lesson and local sources."
  );
  const query = truncateAtParagraphBoundary(
    input.userMessage,
    Math.max(
      24,
      budget.system - estimateTokens(systemInstruction) - 8
    )
  );
  const promptSections = [
    input.activeNodeTitle ? `Current topic: ${input.activeNodeTitle}` : "",
    lessonContext ? `Lesson context:\n${lessonContext}` : "",
    vaultParts.length ? `Local sources:\n${vaultParts.join("\n\n")}` : "",
    historyParts.length ? `Recent conversation:\n${historyParts.join("\n\n")}` : "",
    `Student question: ${query}`,
  ].filter(Boolean);
  const userPrompt = minifyContextText(promptSections.join("\n\n"));
  const totalTokens =
    estimateTokens(systemInstruction) + estimateTokens(userPrompt);
  const originalTokens =
    estimateTokens(input.lessonMarkdown ?? "") +
    input.vaultChunks.reduce(
      (sum, chunk) => sum + estimateTokens(chunk.content),
      0
    ) +
    input.history.reduce((sum, message) => sum + estimateTokens(message.content), 0);

  return {
    systemInstruction: truncateAtParagraphBoundary(
      systemInstruction,
      budget.system
    ),
    userPrompt,
    totalTokens,
    savedPercent:
      originalTokens > 0
        ? Math.max(
            0,
            Math.round((1 - totalTokens / originalTokens) * 100)
          )
        : 0,
  };
}

export function fitRequestToProviderBudget(
  systemInstruction: string,
  userPrompt: string,
  provider: AiProvider,
  schema?: Record<string, unknown>,
  maxInputTokens?: number
): { systemInstruction: string; userPrompt: string } {
  const budget =
    provider === "openai-compatible" && maxInputTokens !== undefined
      ? allocateLocalBudget(Math.max(1, maxInputTokens))
      : getProviderBudget(provider);
  const schemaTokens = schema ? estimateTokens(JSON.stringify(schema)) : 0;
  const totalInputBudget = budget.total;
  const availableText = Math.max(1, totalInputBudget - schemaTokens);
  const system = truncateAtParagraphBoundary(
    minifyContextText(systemInstruction),
    Math.min(budget.system, availableText)
  );
  const userBudget = Math.max(1, availableText - estimateTokens(system));
  const normalizedUser = minifyContextText(userPrompt);
  const questionMarker = "\n\nStudent question: ";
  const questionStart = normalizedUser.lastIndexOf(questionMarker);
  let user: string;
  if (questionStart >= 0) {
    const context = normalizedUser.slice(0, questionStart);
    const question = normalizedUser.slice(questionStart);
    const questionBudget = Math.min(
      userBudget,
      Math.max(24, budget.system - estimateTokens(system))
    );
    const clippedQuestion = truncateAtParagraphBoundary(
      question,
      questionBudget
    );
    user = [
      truncateAtParagraphBoundary(
        context,
        Math.max(0, userBudget - estimateTokens(clippedQuestion))
      ),
      clippedQuestion,
    ]
      .filter(Boolean)
      .join("\n\n");
  } else {
    user = truncateAtParagraphBoundary(normalizedUser, userBudget);
  }
  return { systemInstruction: system, userPrompt: user };
}
