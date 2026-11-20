import { readFile } from "@tauri-apps/plugin-fs";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { chunkDocumentText, computeSha256Hex } from "./chunker";
import {
  findDocumentByHash,
  saveDocumentWithChunks,
  type StoredDocument,
} from "../db/repositories/documentRepo";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface IngestResult {
  document: StoredDocument;
  chunkCount: number;
  deduplicated: boolean;
  extractedText?: string;
}

async function extractPdfText(bytes: Uint8Array): Promise<{
  text: string;
  pageCount: number;
}> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean);
    pageTexts.push(`[Page ${pageNum}]\n${strings.join(" ")}`);
  }

  return {
    text: pageTexts.join("\n\n"),
    pageCount: pdf.numPages,
  };
}

/**
 * Ingests a local file path from Tauri dialog into the offline SQLite + FTS5 vault.
 */
export async function ingestLocalFilePath(
  filePath: string,
  workspaceId: string | null = null,
  includeExtractedText = false
): Promise<IngestResult> {
  const fileBytes = await readFile(filePath);
  const fileName = filePath.split(/[\\/]/).pop() ?? "Untitled";
  return ingestRawBytes(fileBytes, fileName, workspaceId, includeExtractedText);
}

/**
 * Core byte-level ingestion supporting both Tauri FS paths and drag-and-drop File objects.
 */
export async function ingestRawBytes(
  fileBytes: Uint8Array,
  fileName: string,
  workspaceId: string | null = null,
  includeExtractedText = false
): Promise<IngestResult> {
  const arrayBuffer = fileBytes.buffer.slice(
    fileBytes.byteOffset,
    fileBytes.byteOffset + fileBytes.byteLength
  ) as ArrayBuffer;

  const fileHash = await computeSha256Hex(arrayBuffer);
  const existing = await findDocumentByHash(fileHash);
  if (existing && !includeExtractedText) {
    return {
      document: existing,
      chunkCount: 0,
      deduplicated: true,
    };
  }

  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  let rawText = "";
  let pageCount = 1;

  if (isPdf) {
    const extracted = await extractPdfText(fileBytes);
    rawText = extracted.text;
    pageCount = extracted.pageCount;
  } else {
    rawText = new TextDecoder("utf-8").decode(fileBytes);
  }

  if (!rawText.trim()) {
    throw new Error(`No readable text was found in "${fileName}".`);
  }

  if (existing) {
    return {
      document: existing,
      chunkCount: 0,
      deduplicated: true,
      extractedText: includeExtractedText ? rawText : undefined,
    };
  }

  const chunks = chunkDocumentText(rawText);
  const doc: StoredDocument = {
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    file_name: fileName,
    file_hash: fileHash,
    page_count: pageCount,
    created_at: Date.now(),
  };

  const concurrentDuplicate = await saveDocumentWithChunks(doc, chunks);
  if (concurrentDuplicate) {
    return {
      document: concurrentDuplicate,
      chunkCount: 0,
      deduplicated: true,
      extractedText: includeExtractedText ? rawText : undefined,
    };
  }

  return {
    document: doc,
    chunkCount: chunks.length,
    deduplicated: false,
    extractedText: includeExtractedText ? rawText : undefined,
  };
}