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
assert(
  stripMathMarkup(String.raw`Language \(\Sigma^*\) with \$5 and \(\emptyset\)`) ===
    "Language Σ^* with $5 and ∅",
  "canvas hints should display common inline math without raw delimiters"
);

const codeMarkdown = [
  "Inline `\\\\Sigma`",
  "```latex",
  "$\\\\emptyset$",
  "```",
].join("\n");
assert(
  normalizeMathMarkdown(codeMarkdown) === codeMarkdown,
  "math normalization must leave inline and fenced code unchanged"
);

console.log("✓ Rich content math normalization tests passed!");
