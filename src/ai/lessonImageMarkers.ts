export interface LessonImageRequest {
  marker: string;
  query: string;
}

const LESSON_IMAGE_MARKER = /\[\[NOESIS_IMAGE:\s*([^\]\r\n]{3,160})\]\]/i;
const ANY_LESSON_IMAGE_MARKER = /\[\[NOESIS_IMAGE:[^\]\r\n]*\]\]/gi;
const IMAGE_QUERY_STOP_WORDS = new Set([
  "and",
  "for",
  "from",
  "image",
  "photo",
  "the",
  "with",
]);

function imageSearchTerms(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(
        (term) => term.length > 2 && !IMAGE_QUERY_STOP_WORDS.has(term)
      )
  );
}

export function isLessonImageTitleRelevant(
  query: string,
  title: string
): boolean {
  const queryTerms = imageSearchTerms(query);
  if (queryTerms.size === 0) return false;
  const titleTerms = imageSearchTerms(title.replace(/^File:/i, ""));
  const matchingTerms = [...queryTerms].filter((term) =>
    titleTerms.has(term)
  ).length;
  return matchingTerms >= Math.min(2, queryTerms.size);
}

export function extractLessonImageRequest(
  markdown: string
): LessonImageRequest | null {
  const match = LESSON_IMAGE_MARKER.exec(markdown);
  const query = match?.[1]?.trim().replace(/\s+/g, " ");
  if (!match || !query) return null;
  return { marker: match[0], query };
}

export function replaceLessonImageRequest(
  markdown: string,
  marker: string,
  replacement: string
): string {
  const markerIndex = markdown.indexOf(marker);
  const withReplacement =
    markerIndex < 0
      ? markdown
      : `${markdown.slice(0, markerIndex)}${replacement}${markdown.slice(
          markerIndex + marker.length
        )}`;
  return withReplacement
    .replace(ANY_LESSON_IMAGE_MARKER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
