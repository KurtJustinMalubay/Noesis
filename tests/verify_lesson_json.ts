import {
  LESSON_RESPONSE_SCHEMA,
  normalizeGeneratedLessonPayload,
} from "../src/ai/lessonResponse.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const normalized = normalizeGeneratedLessonPayload({
  lessonMarkdown: String.raw`# Lesson\n\nTeach the concept clearly.`,
});
assert(
  normalized.lessonMarkdown === "# Lesson\n\nTeach the concept clearly." &&
    normalized.mermaidDiagram === "" &&
    normalized.imageQuery === "",
  "valid lesson markdown should be retained while absent optional fields default to empty strings"
);
assert(
  LESSON_RESPONSE_SCHEMA.type === "OBJECT" &&
    (LESSON_RESPONSE_SCHEMA.required as string[]).join(",") ===
      "lessonMarkdown,mermaidDiagram,imageQuery",
  "lesson responses should request every field through a strict JSON object schema"
);

for (const invalid of [
  "# Raw Markdown is not a JSON response",
  null,
  [],
  { lessonMarkdown: " \n " },
  { lessonMarkdown: 42 },
]) {
  let rejected = false;
  try {
    normalizeGeneratedLessonPayload(invalid);
  } catch {
    rejected = true;
  }
  assert(rejected, "malformed or empty lesson responses should be rejected");
}

console.log("✓ Structured lesson response tests passed!");
