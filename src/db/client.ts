import Database from "@tauri-apps/plugin-sql";
import { runMigrations } from "./migrations";

export const DB_URL = "sqlite:noesis.db";

let dbInstance: Database | null = null;
let initPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = await Database.load(DB_URL);
    await runMigrations(db);
    const integrity = await db.select<Array<{ quick_check: string }>>(
      "PRAGMA quick_check(1);"
    );
    if (integrity[0]?.quick_check !== "ok") {
      throw new Error(
        `Local database integrity check failed: ${
          integrity[0]?.quick_check ?? "no result returned"
        }`
      );
    }
    dbInstance = db;
    return db;
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}