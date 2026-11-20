import { parseSafeJson } from "../src/ai/jsonSafeParser.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const parsed = parseSafeJson<{
  enabled: boolean;
  count: number | null;
  lesson: string;
}>(`<think>Drafting JSON now.</think>
Here is the result:
\`\`\`json
{
  “enabled”: True,
  “count”: None,
  “lesson”: “Use printf("hello") for output.
Keep the next line indented.”
}
\`\`\``);
assert(
  parsed.enabled && parsed.count === null &&
    parsed.lesson.includes('printf("hello")') &&
    parsed.lesson.includes("\n"),
  "smart quotes, Python literals, embedded quotes, and literal newlines should be repaired"
);

assert(
  parseSafeJson<{ ok: boolean }>("```json {\"ok\": True} ```").ok,
  "single-line JSON fences should be extracted"
);

const truncated = parseSafeJson<Array<{ id: string }>>(
  `[{"id":"complete"},{"id":"unfinished"`,
  { expectArray: true }
);
assert(
  truncated.length === 1 && truncated[0].id === "complete",
  "a truncated array should retain complete items and drop its incomplete final object"
);

const truncatedQuestions = parseSafeJson<{
  label: string;
  questions: Array<{ prompt: string }>;
}>(
  `{"label":"quiz","questions":[{"prompt":"complete"},{"prompt":"unfinished"`
);
assert(
  truncatedQuestions.label === "quiz" &&
    truncatedQuestions.questions.length === 1,
  "truncated object arrays should preserve completed fields and discard only the incomplete item"
);

const codeString = parseSafeJson<{ code: string }>(
  `{"code":"if (value) {\\n\\treturn True;\\n}"}`
);
assert(
  codeString.code.includes("\n\t") && codeString.code.includes("True"),
  "Python-like words inside a JSON string must remain unchanged"
);

const math = parseSafeJson<{ expression: string }>(
  `{"expression":"Use \\frac{a}{b} and \\text{value}."}`
);
assert(
  math.expression.includes("\\frac") && math.expression.includes("\\text"),
  "LaTeX commands that resemble JSON escape sequences should keep their backslashes"
);

console.log("✓ Safe JSON repair tests passed!");
