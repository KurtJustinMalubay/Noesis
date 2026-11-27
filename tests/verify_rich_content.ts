import {
  normalizeMathMarkdown,
  stripMathMarkup,
} from "../src/components/ui/normalizeMathMarkdown.ts";
import { normalizeEscapedMarkdownLineBreaks } from "../src/utils/normalizeEscapedMarkdownLineBreaks.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const normalized = normalizeMathMarkdown(
  String.raw`Inline \( \\Sigma^* \), block \[ \\emptyset \], and $\\varepsilon$; price \$5.`
);

assert(
  normalized.includes(String.raw`$ \Sigma^* $`) &&
    normalized.includes(String.raw`$$ \emptyset $$`) &&
    normalized.includes(String.raw`$\varepsilon$`),
  "alternate delimiters and double-escaped LaTeX commands should normalize"
);
assert(
  normalized.includes(String.raw`\$5`),
  "escaped currency must stay literal"
);
const normalizedFractions = normalizeMathMarkdown(
  String.raw`$$\frac{1}{3} + \frac{1}{4} + {2 \over 5} \div {4 \over 5}$$ and $A \over B$`
);
assert(
  normalizedFractions.includes(String.raw`\frac{2}{5}`) &&
    normalizedFractions.includes(String.raw`\frac{4}{5}`) &&
    normalizedFractions.includes(String.raw`\frac{A}{B}`),
  "infix TeX fractions inside math delimiters should normalize to standard frac commands"
);
const normalizedInlineStyle = normalizeMathMarkdown(
  String.raw`Inline $\dfrac{C^*}{\epsilon}$ and \(\displaystyle\frac{C^*}{\epsilon}\); display $$\dfrac{1}{2}$$ and \[\displaystyle\frac{1}{2}\].`
);
assert(
  normalizedInlineStyle.includes(String.raw`$\frac{C^*}{\epsilon}$`) &&
    normalizedInlineStyle.includes(
      String.raw`$\textstyle\frac{C^*}{\epsilon}$`
    ) &&
    normalizedInlineStyle.includes(String.raw`$$\dfrac{1}{2}$$`) &&
    normalizedInlineStyle.includes(String.raw`$$\displaystyle\frac{1}{2}$$`),
  "inline math should not force display-style fractions, while display equations retain their chosen style"
);
assert(
  stripMathMarkup(String.raw`Language \(\Sigma^*\) with \$5 and \(\emptyset\)`) ===
    "Language Σ^* with $5 and ∅",
  "canvas hints should display common inline math without raw delimiters"
);

const codeMarkdown = [
  "Inline `\\\\Sigma`",
  "Inline fraction `\\(2 \\\\over 5\\)`",
  "```latex",
  "$\\\\emptyset$",
  "\\(2 \\\\over 5\\)",
  "```",
].join("\n");
assert(
  normalizeMathMarkdown(codeMarkdown) === codeMarkdown,
  "math normalization must leave inline and fenced code unchanged"
);
const escapedLineBreakMarkdown = String.raw`# Logic & Proof Techniques:\n\n## 1. Why Logic Matters\nLogic is useful.\n\n\(\nu\)`;
const normalizedLineBreaks = normalizeMathMarkdown(escapedLineBreakMarkdown);
assert(
  normalizedLineBreaks.startsWith(
    String.raw`# Logic & Proof Techniques:

## 1. Why Logic Matters
Logic is useful.

`
  ) &&
    normalizedLineBreaks.endsWith("$\\nu$"),
  "escaped lesson line breaks should restore Markdown structure and preserve LaTeX commands"
);
const malformedMathDelimiters = normalizeMathMarkdown(
  String.raw`Room proportions: $\\Phi \approx 1.618$. Enclosure is \[E = \frac{A_{solid}}{A_{total}}$$ and then $E$ approaches $1$.`
);
assert(
  malformedMathDelimiters.includes(
    String.raw`$$E = \frac{A_{solid}}{A_{total}}$$`
  ) &&
    !malformedMathDelimiters.includes(String.raw`\[E =`) &&
    malformedMathDelimiters.includes(String.raw`$\Phi \approx 1.618$`),
  "mismatched display-math delimiters should normalize rather than leak raw TeX"
);
const alternateMalformedMathDelimiters = normalizeMathMarkdown(
  String.raw`The equation is $$E = \frac{A_{solid}}{A_{total}}\] in the lesson.`
);
assert(
  alternateMalformedMathDelimiters.includes(
    String.raw`$$E = \frac{A_{solid}}{A_{total}}$$`
  ) && !alternateMalformedMathDelimiters.includes(String.raw`\]`),
  "display math closed with an alternate delimiter should be repaired"
);
const escapedLineBreakCode =
  "Inline `" +
  String.raw`\n` +
  "`\n\n```text\n" +
  String.raw`\n` +
  "\n```";
assert(
  normalizeEscapedMarkdownLineBreaks(escapedLineBreakCode) ===
    escapedLineBreakCode,
  "escaped line breaks inside inline and fenced code should remain unchanged"
);

console.log("✓ Rich content math normalization tests passed!");
