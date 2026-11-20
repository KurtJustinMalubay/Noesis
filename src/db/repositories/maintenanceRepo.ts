import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";

export interface DatabaseStats {
  workspaceCount: number;
  nodeCount: number;
  documentCount: number;
  chunkCount: number;
  databaseSizeBytes: number;
}

export async function getDatabaseStats(): Promise<DatabaseStats> {
  const db = await getDb();
  const [workspaces, nodes, documents, chunks, pages, pageSize] =
    await Promise.all([
      db.select<Array<{ count: number }>>(
        "SELECT COUNT(*) AS count FROM workspaces"
      ),
      db.select<Array<{ count: number }>>("SELECT COUNT(*) AS count FROM nodes"),
      db.select<Array<{ count: number }>>(
        "SELECT COUNT(*) AS count FROM documents"
      ),
      db.select<Array<{ count: number }>>(
        "SELECT COUNT(*) AS count FROM doc_chunks"
      ),
      db.select<Array<{ page_count: number }>>("PRAGMA page_count"),
      db.select<Array<{ page_size: number }>>("PRAGMA page_size"),
    ]);

  return {
    workspaceCount: workspaces[0]?.count ?? 0,
    nodeCount: nodes[0]?.count ?? 0,
    documentCount: documents[0]?.count ?? 0,
    chunkCount: chunks[0]?.count ?? 0,
    databaseSizeBytes:
      (pages[0]?.page_count ?? 0) * (pageSize[0]?.page_size ?? 0),
  };
}

export async function rebuildVaultIndex(): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(async () => {
    await db.execute(
      "INSERT INTO doc_chunks_fts(doc_chunks_fts) VALUES ('rebuild')"
    );
    await db.execute(
      "INSERT INTO doc_chunks_fts(doc_chunks_fts) VALUES ('optimize')"
    );
  });
}

export async function compactDatabase(): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(async () => {
    await db.execute("PRAGMA optimize");
    await db.execute("VACUUM");
  });
}

export async function clearGeneratedDiagnostics(): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() => db.execute("DELETE FROM node_quizzes"));
}
