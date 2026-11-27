import { normalizeEscapedMarkdownLineBreaks } from "../utils/normalizeEscapedMarkdownLineBreaks.ts";

export interface GeneratedLessonPayload {
  lessonMarkdown: string;
  mermaidDiagram: string;
  imageQuery: string;
}

export const LESSON_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    lessonMarkdown: { type: "STRING" },
    mermaidDiagram: { type: "STRING" },
    imageQuery: { type: "STRING" },
  },
  required: ["lessonMarkdown", "mermaidDiagram", "imageQuery"],
};

export function normalizeGeneratedLessonPayload(
  value: unknown
): GeneratedLessonPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Lesson response must be a JSON object.");
  }
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.lessonMarkdown !== "string" ||
    !payload.lessonMarkdown.trim()
  ) {
    throw new Error("Lesson response must contain non-empty lessonMarkdown.");
  }
  return {
    lessonMarkdown: normalizeEscapedMarkdownLineBreaks(payload.lessonMarkdown),
    mermaidDiagram:
      typeof payload.mermaidDiagram === "string" ? payload.mermaidDiagram : "",
    imageQuery: typeof payload.imageQuery === "string" ? payload.imageQuery : "",
  };
}
