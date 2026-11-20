import { jsonrepair } from "jsonrepair";

export interface SafeJsonOptions {
  expectArray?: boolean;
}

function stripThinkingBlocks(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "")
    .replace(/<think\b[^>]*>[\s\S]*$/i, "");
}

function selectResponseBody(text: string): string {
  const jsonOpening = /```json\b[ \t]*(?:\r?\n)?/i.exec(text);
  if (jsonOpening) {
    const bodyStart = jsonOpening.index + jsonOpening[0].length;
    const closing = text.lastIndexOf("```");
    if (closing > bodyStart) return text.slice(bodyStart, closing).trim();
  }

  const fences = [
    ...text.matchAll(/```([^\r\n`]*)\r?\n?([\s\S]*?)```/g),
  ].map((match) => ({
    language: (match[1] ?? "").trim().toLowerCase(),
    content: match[2] ?? "",
  }));
  const selected =
    fences.find((fence) => fence.language === "json") ??
    fences.find((fence) => /^[\s]*[\[{]/.test(fence.content)) ??
    fences[0];
  if (selected) return selected.content.trim();

  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function replacePythonLiterals(text: string): string {
  const replacements: Record<string, string> = {
    True: "true",
    False: "false",
    None: "null",
  };
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; ) {
    const character = text[index];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      index += 1;
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      index += 1;
      continue;
    }

    const literal = Object.keys(replacements).find((candidate) => {
      if (!text.startsWith(candidate, index)) return false;
      const before = text[index - 1] ?? "";
      const after = text[index + candidate.length] ?? "";
      return !/[\w$]/.test(before) && !/[\w$]/.test(after);
    });
    if (literal) {
      result += replacements[literal];
      index += literal.length;
    } else {
      result += character;
      index += 1;
    }
  }

  return result;
}

function sanitizeJsonText(text: string): string {
  const normalizedQuotes = text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < normalizedQuotes.length; index += 1) {
    const character = normalizedQuotes[index];
    if (inString) {
      if (escaped) {
        result += character;
        escaped = false;
      } else if (character === "\\") {
        const next = normalizedQuotes[index + 1] ?? "";
        const validBasicEscape = '"\\/'.includes(next);
        const validUnicodeEscape =
          next === "u" &&
          /^[0-9a-f]{4}$/i.test(normalizedQuotes.slice(index + 2, index + 6));
        const looksLikeLatexCommand =
          (next === "b" &&
            /^(?:beta|begin|bar|bf|big)/i.test(normalizedQuotes.slice(index + 1))) ||
          (next === "f" &&
            /^(?:frac|forall|floor|font)/i.test(normalizedQuotes.slice(index + 1))) ||
          (next === "n" &&
            /^(?:neq|nabla|nu|not)/i.test(normalizedQuotes.slice(index + 1))) ||
          (next === "r" &&
            /^(?:right|rho|rightarrow|root)/i.test(normalizedQuotes.slice(index + 1))) ||
          (next === "t" &&
            /^(?:text|theta|tau|times|to)/i.test(
              normalizedQuotes.slice(index + 1)
            ));
        const validControlEscape =
          "bfnrt".includes(next) && !looksLikeLatexCommand;
        if (validBasicEscape || validUnicodeEscape || validControlEscape) {
          result += character;
          escaped = true;
        } else {
          result += "\\\\";
        }
      } else if (character === '"') {
        let nextIndex = index + 1;
        while (
          /\s/.test(normalizedQuotes[nextIndex] ?? "") &&
          nextIndex < normalizedQuotes.length
        ) {
          nextIndex += 1;
        }
        const next = normalizedQuotes[nextIndex];
        if (next === undefined || [",", "}", "]", ":"].includes(next)) {
          result += character;
          inString = false;
        } else {
          result += '\\"';
        }
      } else if (character === "\n") {
        result += "\\n";
      } else if (character === "\r") {
        result += "\\r";
      } else if (character === "\t") {
        result += "\\t";
      } else {
        result += character;
      }
    } else {
      result += character;
      if (character === '"') inString = true;
    }
  }

  return replacePythonLiterals(result);
}

function extractJsonContainer(text: string): string {
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") {
      start = index;
      break;
    }
  }

  if (start < 0) return "";
  const close = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  return text.slice(start, end >= start ? end + 1 : undefined).trim();
}

function parseRepairedValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return JSON.parse(jsonrepair(text)) as unknown;
  }
}

function parseArrayItems(text: string, openIndex: number): unknown[] {
  const values: unknown[] = [];
  let itemStart = openIndex + 1;
  let inString = false;
  let escaped = false;
  const nesting: string[] = [];

  const appendItem = (end: number) => {
    const candidate = text.slice(itemStart, end).trim();
    if (!candidate) return;
    try {
      values.push(parseRepairedValue(candidate));
    } catch {
      // Invalid complete items are skipped; an incomplete final item is never added.
    }
  };

  for (let index = itemStart; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      nesting.push(character === "{" ? "}" : "]");
    } else if (character === "}" || character === "]") {
      if (nesting.length > 0) {
        if (nesting[nesting.length - 1] === character) nesting.pop();
        else return values;
      } else if (character === "]") {
        appendItem(index);
        return values;
      }
    } else if (character === "," && nesting.length === 0) {
      appendItem(index);
      itemStart = index + 1;
    }
  }

  if (!inString && nesting.length === 0) appendItem(text.length);
  return values;
}

function findArrayValue(text: string, keys: string[]): unknown[] | null {
  for (const key of keys) {
    const property = new RegExp(`"${key}"\\s*:\\s*\\[`, "i").exec(text);
    if (property) {
      const openIndex = property.index + property[0].lastIndexOf("[");
      return parseArrayItems(text, openIndex);
    }
  }
  return null;
}

function findUnclosedArray(
  text: string,
  openIndex: number
): boolean {
  let inString = false;
  let escaped = false;
  const nesting: string[] = [];
  for (let cursor = openIndex + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") {
      nesting.push(character === "{" ? "}" : "]");
    } else if (character === "}" || character === "]") {
      if (nesting.length > 0) {
        if (nesting[nesting.length - 1] !== character) return false;
        nesting.pop();
      } else if (character === "]") {
        return false;
      }
    }
  }
  return true;
}

function findTruncatedArrayStart(
  text: string,
  expectArray: boolean
): { index: number; key: string | null } | null {
  if (expectArray) {
    const index = text.indexOf("[");
    return index >= 0 && findUnclosedArray(text, index)
      ? { index, key: null }
      : null;
  }

  const properties = [
    ...text.matchAll(/"(questions|flashcards|results|nodes|n|edges|e)"\s*:\s*\[/gi),
  ].map((match) => ({
    index: match.index! + match[0].lastIndexOf("["),
    key: match[1].toLowerCase(),
  }));
  return (
    properties.find((property) => findUnclosedArray(text, property.index)) ??
    null
  );
}

function salvageArray(text: string, expectArray: boolean): unknown | null {
  const firstArray = text.indexOf("[");
  if (expectArray && firstArray >= 0) {
    return parseArrayItems(text, firstArray);
  }
  const keys = ["questions", "flashcards", "results", "nodes", "n", "edges", "e"];
  for (const key of keys) {
    const items = findArrayValue(text, [key]);
    if (items) return { [key]: items };
  }
  return null;
}

function isEmptyStructuredResult(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (!value || typeof value !== "object") return true;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 0) return true;
  if (["questions", "results", "nodes", "n"].some(
    (key) => Array.isArray(record[key]) && (record[key] as unknown[]).length === 0
  )) {
    return true;
  }
  return (
    Array.isArray(record.flashcards) &&
    record.flashcards.length === 0 &&
    Object.keys(record).every((key) => key === "flashcards" || !record[key])
  );
}

export function hasStructuredContent(value: unknown): boolean {
  return !isEmptyStructuredResult(value);
}

export function parseSafeJson<T>(
  rawText: string,
  options: SafeJsonOptions = {}
): T {
  const stripped = stripThinkingBlocks(rawText);
  const source = extractJsonContainer(
    sanitizeJsonText(selectResponseBody(stripped))
  );
  if (!source) throw new SyntaxError("No JSON object or array was found.");

  const truncatedArray = findTruncatedArrayStart(
    source,
    options.expectArray ?? false
  );
  if (truncatedArray) {
    const items = parseArrayItems(source, truncatedArray.index);
    if (!truncatedArray.key && !isEmptyStructuredResult(items)) {
      return items as T;
    }
    if (truncatedArray.key && !isEmptyStructuredResult({ [truncatedArray.key]: items })) {
      const partialSource = `${source.slice(
        0,
        truncatedArray.index
      )}${JSON.stringify(items)}]`;
      try {
        const partial = parseRepairedValue(partialSource);
        if (!isEmptyStructuredResult(partial)) return partial as T;
      } catch {
        return { [truncatedArray.key]: items } as T;
      }
    }
  }

  try {
    const parsed = parseRepairedValue(source);
    if (options.expectArray) {
      if (Array.isArray(parsed)) return parsed as T;
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const array = record.flashcards ?? record.questions;
        if (Array.isArray(array)) return array as T;
      }
      throw new SyntaxError("Expected a JSON array.");
    }
    return parsed as T;
  } catch (error) {
    const salvaged = salvageArray(source, options.expectArray ?? false);
    if (salvaged !== null && !isEmptyStructuredResult(salvaged)) {
      return salvaged as T;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new SyntaxError(`Could not repair JSON response: ${detail}`);
  }
}
