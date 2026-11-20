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
    dbInstance = db;
    return db;
  })();

  return initPromise;
}