export interface RankedVaultChunk {
  file_name: string;
  heading: string | null;
  content: string;
  rank: number;
}

interface HeapEntry<T> {
  item: T;
  score: number;
}

function hashNormalizedPrefix(text: string): number {
  const prefix = text
    .slice(0, 320)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  let hash = 2166136261;
  for (let index = 0; index < prefix.length; index += 1) {
    hash ^= prefix.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scoreChunk<T extends RankedVaultChunk>(
  chunk: T,
  queryTerms: string[]
): number {
  const searchable = new Set(
    `${chunk.file_name} ${chunk.heading ?? ""} ${chunk.content}`
      .toLowerCase()
      .match(/[\p{L}\p{N}_-]+/gu) ?? []
  );
  const matchingTerms = new Set(
    queryTerms.filter((term) => searchable.has(term))
  ).size;
  const overlap = queryTerms.length ? matchingTerms / queryTerms.length : 0;
  return chunk.rank - overlap * Math.max(0.1, Math.abs(chunk.rank) * 0.25);
}

function isWorse<T extends RankedVaultChunk>(
  first: HeapEntry<T>,
  second: HeapEntry<T>
) {
  return first.score > second.score;
}

function siftUp<T extends RankedVaultChunk>(
  heap: HeapEntry<T>[],
  startIndex: number
): void {
  let index = startIndex;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!isWorse(heap[index], heap[parent])) break;
    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
}

function siftDown<T extends RankedVaultChunk>(
  heap: HeapEntry<T>[],
  startIndex: number
): void {
  let index = startIndex;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (left < heap.length && isWorse(heap[left], heap[worst])) worst = left;
    if (right < heap.length && isWorse(heap[right], heap[worst])) worst = right;
    if (worst === index) return;
    [heap[index], heap[worst]] = [heap[worst], heap[index]];
    index = worst;
  }
}

export function selectTopVaultChunks<T extends RankedVaultChunk>(
  candidates: T[],
  rawQuery: string,
  limit = 4
): T[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0 || candidates.length === 0) return [];

  const queryTerms = Array.from(
    new Set(
      rawQuery
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]{2,}/gu) ?? []
    )
  );
  const hashes = new Set<number>();
  const heap: HeapEntry<T>[] = [];

  for (const item of candidates) {
    const prefixHash = hashNormalizedPrefix(item.content);
    if (hashes.has(prefixHash)) continue;
    hashes.add(prefixHash);
    const entry = {
      item,
      score: scoreChunk(item, queryTerms),
    };

    if (heap.length < safeLimit) {
      heap.push(entry);
      siftUp(heap, heap.length - 1);
    } else if (entry.score < heap[0].score) {
      heap[0] = entry;
      siftDown(heap, 0);
    }
  }

  return heap
    .sort((a, b) => a.score - b.score)
    .map(({ item }) => item);
}
