const FENCED_CODE_PATTERN =
  /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;
const INLINE_CODE_PATTERN = /(`+)(?!`)([^\r\n]*?)\1(?!`)/g;
const ESCAPED_LINE_BREAK_PATTERN = /(?:\\\\|\\)(?:r(?:\\\\|\\)?n|n|r)/g;
const MARKDOWN_LINE_START_PATTERN =
  /^(?:(?:\\\\|\\)(?:r(?:\\\\|\\)?n|n|r)|#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?|```|~~~|\\\(|\\\[|\$\$|[A-Z0-9*_`])/;

export function stripControlCharacters(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // Strip stray ASCII control chars while preserving tab (\x09) and newline (\x0A).
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export function normalizeEscapedMarkdownLineBreaks(markdown: string): string {
  const cleaned = stripControlCharacters(markdown);
  const protectedCode: string[] = [];
  const protectCode = (code: string) => {
    const index = protectedCode.push(code) - 1;
    return `NOESIS_MARKDOWN_CODE_${index}_END`;
  };

  const normalized = cleaned
    .replace(FENCED_CODE_PATTERN, protectCode)
    .replace(INLINE_CODE_PATTERN, protectCode)
    .replace(
      ESCAPED_LINE_BREAK_PATTERN,
      (lineBreak, offset: number, source: string) => {
        const after = source.slice(offset + lineBreak.length);
        return after.length === 0 || MARKDOWN_LINE_START_PATTERN.test(after)
          ? "\n"
          : lineBreak;
      }
    );

  return normalized.replace(
    /NOESIS_MARKDOWN_CODE_(\d+)_END/g,
    (_match, index: string) => protectedCode[Number(index)] ?? ""
  );
}
