import type Database from "@tauri-apps/plugin-sql";
import { getDb } from "../client";
import { buildMultiRowInsert } from "../batch";
import { serializeDbWrite } from "../writeQueue";
import type { TextChunk } from "../../vault/chunker";
import { selectTopVaultChunks } from "../../vault/search";

export interface StoredDocument {
  id: string;
  workspace_id: string | null;
  file_name: string;
  file_hash: string;
  page_count: number;
  created_at: number;
}

export interface RetrievedChunk {
  chunk_id: number;
  doc_id: string;
  file_name: string;
  heading: string | null;
  content: string;
  rank: number;
}

export async function findDocumentByHash(
  fileHash: string
): Promise<StoredDocument | null> {
  const db = await getDb();
  const rows = await db.select<StoredDocument[]>(
    "SELECT * FROM documents WHERE file_hash = $1 LIMIT 1",
    [fileHash]
  );
  return rows[0] ?? null;
}

export async function listDocuments(
  workspaceId?: string
): Promise<StoredDocument[]> {
  const db = await getDb();
  if (workspaceId) {
    return db.select<StoredDocument[]>(
      `SELECT d.* FROM documents d
       WHERE d.workspace_id = $1
          OR EXISTS (
            SELECT 1 FROM document_workspaces dw
            WHERE dw.doc_id = d.id AND dw.workspace_id = $1
          )
          OR (
            d.workspace_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM document_workspaces dw WHERE dw.doc_id = d.id
            )
          )
       ORDER BY d.created_at DESC`,
      [workspaceId]
    );
  }
  return db.select<StoredDocument[]>(
    "SELECT * FROM documents ORDER BY created_at DESC"
  );
}

async function insertWorkspaceDocumentLink(
  db: Database,
  docId: string,
  workspaceId: string | null
): Promise<void> {
  if (!workspaceId) return;
  const documentRows = await db.select<Array<{ workspace_id: string | null }>>(
    "SELECT workspace_id FROM documents WHERE id = $1",
    [docId]
  );
  const document = documentRows[0];
  if (!document) {
    throw new Error("Cannot share a document that is no longer in the vault.");
  }
  if (document.workspace_id === null) {
    const workspaceLinks = await db.select<Array<{ workspace_id: string }>>(
      "SELECT workspace_id FROM document_workspaces WHERE doc_id = $1 LIMIT 1",
      [docId]
    );
    if (workspaceLinks.length === 0) return;
  }
  await db.execute(
    `INSERT OR IGNORE INTO document_workspaces (doc_id, workspace_id)
     VALUES ($1, $2)`,
    [docId, workspaceId]
  );
}

export async function associateDocumentWithWorkspace(
  docId: string,
  workspaceId: string | null
): Promise<void> {
  if (!workspaceId) return;
  const db = await getDb();
  await serializeDbWrite(() =>
    insertWorkspaceDocumentLink(db, docId, workspaceId)
  );
}

export async function saveDocumentWithChunks(
  doc: StoredDocument,
  chunks: TextChunk[]
): Promise<StoredDocument | null> {
  const db = await getDb();
  return serializeDbWrite(async () => {
    const existing = await db.select<StoredDocument[]>(
      "SELECT * FROM documents WHERE file_hash = $1 LIMIT 1",
      [doc.file_hash]
    );
    if (existing[0]) {
      await insertWorkspaceDocumentLink(db, existing[0].id, doc.workspace_id);
      return existing[0];
    }

    let documentInserted = false;
    try {
      await db.execute(
        `INSERT INTO documents (id, workspace_id, file_name, file_hash, page_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          doc.id,
          doc.workspace_id,
          doc.file_name,
          doc.file_hash,
          doc.page_count,
          doc.created_at,
        ]
      );
      documentInserted = true;
      await insertWorkspaceDocumentLink(db, doc.id, doc.workspace_id);

      const batches = buildMultiRowInsert(
        "doc_chunks",
        ["doc_id", "chunk_index", "heading", "content"],
        chunks.map((chunk) => [
          doc.id,
          chunk.chunkIndex,
          chunk.heading,
          chunk.content,
        ])
      );
      for (const batch of batches) {
        await db.execute(batch.sql, batch.params);
      }
    } catch (error) {
      if (documentInserted) {
        try {
          await db.execute("DELETE FROM documents WHERE id = $1", [doc.id]);
        } catch (cleanupError) {
          throw new Error(
            `Vault import failed (${String(error)}) and partial document cleanup failed (${String(cleanupError)}).`
          );
        }
      }
      throw error;
    }

    return null;
  });
}

export async function deleteDocument(docId: string): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute("DELETE FROM documents WHERE id = $1", [docId])
  );
}

export async function countDocumentChunks(docId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<Array<{ count: number }>>(
    "SELECT COUNT(*) AS count FROM doc_chunks WHERE doc_id = $1",
    [docId]
  );
  const count = rows[0]?.count;
  if (count === undefined) {
    throw new Error("Failed to retrieve the document chunk count.");
  }
  return count;
}

/**
 * Queries SQLite FTS5 using BM25 ranking, safely sanitizing user tokens into OR prefix queries.
 */
export async function searchVaultFts(
  rawQuery: string,
  limit = 6,
  workspaceId?: string
): Promise<RetrievedChunk[]> {
  const tokens = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) return [];
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) return [];

  const ftsQuery = tokens.map((t) => `"${t}"*`).join(" OR ");
  const db = await getDb();
  const candidateLimit = Math.min(48, safeLimit * 6);

  if (workspaceId) {
    const candidates = await db.select<RetrievedChunk[]>(
      `SELECT
         c.id AS chunk_id,
         c.doc_id,
         d.file_name,
         c.heading,
         c.content,
         bm25(doc_chunks_fts) AS rank
       FROM doc_chunks_fts f
       JOIN doc_chunks c ON c.id = f.rowid
       JOIN documents d ON d.id = c.doc_id
       WHERE doc_chunks_fts MATCH $1
         AND (
           d.workspace_id = $2 OR
           EXISTS (
             SELECT 1 FROM document_workspaces dw
             WHERE dw.doc_id = d.id AND dw.workspace_id = $2
           ) OR (
             d.workspace_id IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM document_workspaces dw WHERE dw.doc_id = d.id
             )
           )
         )
       ORDER BY rank ASC
       LIMIT $3`,
      [ftsQuery, workspaceId, candidateLimit]
    );
    return selectTopVaultChunks(candidates, rawQuery, safeLimit);
  }

  const candidates = await db.select<RetrievedChunk[]>(
    `SELECT
       c.id AS chunk_id,
       c.doc_id,
       d.file_name,
       c.heading,
       c.content,
       bm25(doc_chunks_fts) AS rank
     FROM doc_chunks_fts f
     JOIN doc_chunks c ON c.id = f.rowid
     JOIN documents d ON d.id = c.doc_id
     WHERE doc_chunks_fts MATCH $1
     ORDER BY rank ASC
     LIMIT $2`,
    [ftsQuery, candidateLimit]
  );
  return selectTopVaultChunks(candidates, rawQuery, safeLimit);
}