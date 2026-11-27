export interface DomWordEntry {
  node: Text;
  start: number;
  end: number;
  normalized: string;
}

const HIGHLIGHT_NAME = "noesis-tts-word";
let sharedHighlight: Highlight | null = null;

export function clearWordHighlight(): void {
  if (sharedHighlight) {
    sharedHighlight.clear();
  }
  if (typeof CSS !== "undefined" && "highlights" in CSS) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
  }
}

export function collectDomWords(container: HTMLElement): DomWordEntry[] {
  const words: DomWordEntry[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(".katex-mathml, script, style")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current: Node | null;
  while ((current = walker.nextNode())) {
    const textNode = current as Text;
    const text = textNode.nodeValue ?? "";
    const regex = /[A-Za-z0-9']+/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const normalized = match[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!normalized) continue;
      words.push({
        node: textNode,
        start: match.index,
        end: match.index + match[0].length,
        normalized,
      });
    }
  }
  return words;
}

export function highlightSpokenWord(
  words: DomWordEntry[],
  spokenWord: string,
  progressRatio: number,
  cursorIndex: number
): { matchedIndex: number; range: Range | null } {
  const firstSegment = spokenWord.split(/[-–—]/)[0] ?? spokenWord;
  const normalizedTarget = firstSegment.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalizedTarget || words.length === 0) {
    return { matchedIndex: cursorIndex, range: null };
  }

  const estimatedIndex = Math.min(
    words.length - 1,
    Math.max(0, Math.floor(progressRatio * words.length))
  );

  // Search forward from cursor first (tight lookahead for 1:1 tracking),
  // then fall back to a narrow window around estimatedIndex.
  const searchStart = Math.max(0, cursorIndex);
  const searchEnd = Math.min(words.length, Math.max(searchStart + 12, estimatedIndex + 8));

  let foundIndex = -1;
  for (let i = searchStart; i < searchEnd; i += 1) {
    if (words[i].normalized === normalizedTarget) {
      foundIndex = i;
      break;
    }
  }

  if (foundIndex === -1) {
    const windowStart = Math.max(0, estimatedIndex - 6);
    const windowEnd = Math.min(words.length, estimatedIndex + 8);
    for (let i = windowStart; i < windowEnd; i += 1) {
      if (words[i].normalized === normalizedTarget) {
        foundIndex = i;
        break;
      }
    }
  }

  if (foundIndex === -1) {
    return { matchedIndex: Math.max(cursorIndex, estimatedIndex), range: null };
  }

  const entry = words[foundIndex];
  const range = document.createRange();
  range.setStart(entry.node, entry.start);
  range.setEnd(entry.node, entry.end);

  if (typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined") {
    if (!sharedHighlight) {
      sharedHighlight = new Highlight(range);
      CSS.highlights.set(HIGHLIGHT_NAME, sharedHighlight);
    } else {
      sharedHighlight.clear();
      sharedHighlight.add(range);
      if (!CSS.highlights.has(HIGHLIGHT_NAME)) {
        CSS.highlights.set(HIGHLIGHT_NAME, sharedHighlight);
      }
    }
  }

  return { matchedIndex: foundIndex + 1, range };
}
