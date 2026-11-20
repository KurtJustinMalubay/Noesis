import {
  normalizeMathMarkdown,
  stripMathMarkup,
} from "../src/components/ui/normalizeMathMarkdown.ts";

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

console.log("✓ Rich content math normalization tests passed!");
