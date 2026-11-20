import type Database from "@tauri-apps/plugin-sql";
import { serializeDbWrite } from "./writeQueue.ts";

const SQLITE_PARAMETER_LIMIT = 999;

export interface SqlBatch {
  sql: string;
  params: unknown[];
}

export function buildMultiRowInsert(
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictAction: "INSERT" | "INSERT OR REPLACE" | "INSERT OR IGNORE" = "INSERT",
  maxRows = 50
): SqlBatch[] {
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error("A multi-row insert batch size must be a positive integer.");
  }
  if (rows.some((row) => row.length !== columns.length)) {
    throw new Error(`Rows for ${table} must match its ${columns.length} columns.`);
  }
  if (columns.length === 0) {
    throw new Error("A multi-row insert requires at least one column.");
  }

  const safeBatchSize = Math.min(
    maxRows,
    Math.floor(SQLITE_PARAMETER_LIMIT / columns.length)
  );
  if (safeBatchSize < 1) {
    throw new Error("A multi-row insert batch must fit within SQLite's parameter limit.");
  }
  const batches: SqlBatch[] = [];

  for (let offset = 0; offset < rows.length; offset += safeBatchSize) {
    const batchRows = rows.slice(offset, offset + safeBatchSize);
    const values = batchRows.map((_, rowIndex) => {
      const base = rowIndex * columns.length;
      return `(${columns.map((__, columnIndex) => `$${base + columnIndex + 1}`).join(", ")})`;
    });
    batches.push({
      sql: `${conflictAction} INTO ${table} (${columns.join(", ")}) VALUES ${values.join(", ")}`,
      params: batchRows.flat(),
    });
  }
  return batches;
}

/**
 * Serializes a sequence of parameterized writes without relying on connection-scoped transactions.
 */
export async function executeBatch(
  db: Database,
  sql: string,
  paramRows: unknown[][]
): Promise<void> {
  if (paramRows.length === 0) return;

  await serializeDbWrite(async () => {
    for (const params of paramRows) {
      await db.execute(sql, params);
    }
  });
}