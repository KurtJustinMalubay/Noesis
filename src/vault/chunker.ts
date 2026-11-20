export interface TextChunk {
  chunkIndex: number;
  heading: string | null;
  content: string;
}

const TARGET_CHUNK_CHARS = 1200;
const OVERLAP_CHARS = 150;

/**
 * Splits raw document text into heading-aware chunks with light overlap
 * so FTS5 BM25 queries preserve section context.
 */
export function chunkDocumentText(rawText: string): TextChunk[] {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const sections: Array<{ heading: string | null; body: string }> = [];

  let currentHeading: string | null = null;
  let buffer: string[] = [];

  const flushSection = () => {
    const body = buffer.join("\n").trim();
    if (body) {
      sections.push({ heading: currentHeading, body });
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    const pageMarkerMatch = line.match(/^\[Page\s+\d+\]$/i);

    if (headingMatch) {
      flushSection();
      currentHeading = headingMatch[2].trim();
    } else if (pageMarkerMatch) {
      flushSection();
      currentHeading = line.trim();
    } else {
      buffer.push(line);
    }
  }
  flushSection();

  const chunks: TextChunk[] = [];
  let chunkIndex = 0;

  for (const sec of sections) {
    if (sec.body.length <= TARGET_CHUNK_CHARS) {
      chunks.push({
        chunkIndex: chunkIndex++,
        heading: sec.heading,
        content: sec.body,
      });
      continue;
    }

    let start = 0;
    while (start < sec.body.length) {
      let end = Math.min(start + TARGET_CHUNK_CHARS, sec.body.length);

      // Snap to nearest paragraph or sentence boundary if not at end
      if (end < sec.body.length) {
        const window = sec.body.slice(start, end);
        const paraBreak = window.lastIndexOf("\n\n");
        const sentenceBreak = window.lastIndexOf(". ");
        if (paraBreak > TARGET_CHUNK_CHARS * 0.5) {
          end = start + paraBreak;
        } else if (sentenceBreak > TARGET_CHUNK_CHARS * 0.5) {
          end = start + sentenceBreak + 1;
        }
      }

      const slice = sec.body.slice(start, end).trim();
      if (slice) {
        chunks.push({
          chunkIndex: chunkIndex++,
          heading: sec.heading,
          content: slice,
        });
      }

      if (end >= sec.body.length) break;
      start = Math.max(end - OVERLAP_CHARS, start + 1);
    }
  }

  return chunks;
}

/**
 * Computes a deterministic SHA-256 hex digest using native Web Crypto.
 */
export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}