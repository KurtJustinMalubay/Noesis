const FENCED_CODE_PATTERN =
  /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;
const INLINE_CODE_PATTERN = /(`+)(?!`)([^\r\n]*?)\1(?!`)/g;

function normalizeLatexCommands(expression: string): string {
  return expression.replace(/\\\\(?=[A-Za-z])/g, "\\");
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
        `${delimiter}${normalizeLatexCommands(expression)}${delimiter}`
    );

  return normalized.replace(
    /NOESIS_CODE_PLACEHOLDER_(\d+)_END/g,
    (_match, index: string) => protectedCode[Number(index)] ?? ""
  );
}
