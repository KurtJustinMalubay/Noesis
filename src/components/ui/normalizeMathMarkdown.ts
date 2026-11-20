const FENCED_CODE_PATTERN =
  /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;
const INLINE_CODE_PATTERN = /(`+)(?!`)([^\r\n]*?)\1(?!`)/g;

function normalizeLatexCommands(expression: string): string {
  return expression.replace(/\\\\(?=[A-Za-z])/g, "\\");
}

function hasWrappingBraces(value: string): boolean {
  if (!value.startsWith("{") || !value.endsWith("}")) return false;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{") depth += 1;
    if (value[index] === "}") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function normalizeOverFractions(expression: string): string {
  const leading = expression.match(/^\s*/)?.[0] ?? "";
  const trailing = expression.match(/\s*$/)?.[0] ?? "";
  const value = expression.trim();
  if (hasWrappingBraces(value)) {
    return `${leading}${normalizeOverFractions(value.slice(1, -1))}${trailing}`;
  }

  let result = "";
  let groupStart = -1;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{") {
      if (depth === 0) groupStart = index;
      depth += 1;
    } else if (value[index] === "}") {
      depth -= 1;
      if (depth === 0 && groupStart >= 0) {
        result += `{${normalizeOverFractions(value.slice(groupStart + 1, index))}}`;
        groupStart = -1;
        continue;
      }
    }
    if (depth === 0) result += value[index];
  }

  depth = 0;
  for (let index = 0; index < result.length; index += 1) {
    if (result[index] === "{") depth += 1;
    else if (result[index] === "}") depth -= 1;
    else if (
      depth === 0 &&
      result.slice(index).match(/^\\over\b/)
    ) {
      const numerator = result.slice(0, index).trim();
      const denominator = result.slice(index + "\\over".length).trim();
      if (numerator && denominator) {
        return `${leading}\\frac{${unwrapGroup(numerator)}}{${unwrapGroup(
          denominator
        )}}${trailing}`;
      }
    }
  }
  return `${leading}${result}${trailing}`;
}

function unwrapGroup(value: string): string {
  return hasWrappingBraces(value.trim()) ? value.trim().slice(1, -1) : value.trim();
}

export function stripMathMarkup(value: string): string {
  const symbols: Record<string, string> = {
    Sigma: "Σ",
    sigma: "σ",
    varepsilon: "ε",
    epsilon: "ε",
    emptyset: "∅",
    subseteq: "⊆",
    ge: "≥",
    le: "≤",
    in: "∈",
    to: "→",
    rightarrow: "→",
    leftarrow: "←",
    times: "×",
    cdot: "·",
    alpha: "α",
    beta: "β",
    pi: "π",
    omega: "ω",
  };

  return value
    .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
    .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/(?<!\\)\$([^$\n]+)\$(?!\$)/g, "$1")
    .replace(/\\\\(?=[A-Za-z])/g, "\\")
    .replace(
      /\\([A-Za-z]+)/g,
      (_command, name: string) => symbols[name] ?? name
    )
    .replace(/\\([{}_$])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeMathMarkdown(markdown: string): string {
  const protectedCode: string[] = [];
  const protectCode = (code: string) => {
    const index = protectedCode.push(code) - 1;
    return `NOESIS_CODE_PLACEHOLDER_${index}_END`;
  };

  let normalized = markdown
    .replace(FENCED_CODE_PATTERN, protectCode)
    .replace(INLINE_CODE_PATTERN, protectCode);

  normalized = normalized
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expression: string) =>
      `$${normalizeLatexCommands(expression)}$`
    )
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expression: string) =>
      `$$${normalizeLatexCommands(expression)}$$`
    )
    .replace(
      /(?<!\\)(\${1,2})([\s\S]*?)(?<!\\)\1/g,
      (_match, delimiter: string, expression: string) =>
        `${delimiter}${normalizeOverFractions(
          normalizeLatexCommands(expression)
        )}${delimiter}`
    );

  return normalized.replace(
    /NOESIS_CODE_PLACEHOLDER_(\d+)_END/g,
    (_match, index: string) => protectedCode[Number(index)] ?? ""
  );
}
