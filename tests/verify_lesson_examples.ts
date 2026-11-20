import { DatabaseSync } from "node:sqlite";
import type Database from "@tauri-apps/plugin-sql";
import { runMigrations } from "../src/db/migrations.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function run(): Promise<void> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      root_domain TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO workspaces (id, title, root_domain, created_at, updated_at)
      VALUES ('legacy-workspace', 'Legacy', 'Test', 1, 1);
    PRAGMA user_version = 6;
  `);
  const adapter = {
    execute: async (query: string) => {
      sqlite.exec(query);
      return { rowsAffected: 0 };
    },
    select: async <T>(query: string) =>
      sqlite.prepare(query).all() as T,
  } as unknown as Database;

  await runMigrations(adapter);
  const version = sqlite.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  assert(version.user_version === 7, "migrations should advance the schema to v7");
  const workspaceColumns = sqlite
    .prepare("PRAGMA table_info(workspaces)")
    .all() as Array<{ name: string; dflt_value: string | null }>;
  const layoutMode = workspaceColumns.find(
    (column) => column.name === "layout_mode"
  );
  assert(
    layoutMode?.dflt_value === "'auto'",
    "new and existing workspaces should default to Auto-Layout"
  );
  const legacyMode = sqlite
    .prepare("SELECT layout_mode FROM workspaces WHERE id = ?")
    .get("legacy-workspace") as { layout_mode: string };
  assert(
    legacyMode.layout_mode === "auto",
    "existing workspaces should migrate to Auto-Layout"
  );

  sqlite
    .prepare(
      "INSERT INTO workspaces (id, title, root_domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run("workspace", "Test", "Test", 1, 1);
  const newWorkspaceMode = sqlite
    .prepare("SELECT layout_mode FROM workspaces WHERE id = ?")
    .get("workspace") as { layout_mode: string };
  assert(
    newWorkspaceMode.layout_mode === "auto",
    "new workspaces should use Auto-Layout by default"
  );
  sqlite
    .prepare(
      "INSERT INTO nodes (id, workspace_id, title, summary_hint, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run("node", "workspace", "Concept", "Summary", 1);
  sqlite
    .prepare(
      "INSERT INTO nodes (id, workspace_id, title, summary_hint, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run("custom-node", "workspace", "Custom concept", "User-authored", 2);
  const customNode = sqlite
    .prepare("SELECT title, is_hydrated FROM nodes WHERE id = ?")
    .get("custom-node") as { title: string; is_hydrated: number };
  assert(
    customNode.title === "Custom concept" && customNode.is_hydrated === 0,
    "migrated node schema should support unhydrated custom concepts"
  );
  sqlite
    .prepare(
      "INSERT INTO edges (workspace_id, source_id, target_id) VALUES (?, ?, ?)"
    )
    .run("workspace", "node", "custom-node");
  const edgeCount = sqlite
    .prepare("SELECT COUNT(*) AS count FROM edges WHERE workspace_id = ?")
    .get("workspace") as { count: number };
  assert(edgeCount.count === 1, "migrated edge schema should persist prerequisites");

  const insert = sqlite.prepare(
    `INSERT INTO lesson_examples
      (id, node_id, user_prompt, tools_json, content_markdown, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  insert.run("example-1", "node", "Trace a DFA", '["mermaid"]', "Example A", "2026-01-01");
  insert.run("example-2", "node", "", "[]", "Example B", "2026-01-02");

  const listed = sqlite
    .prepare(
      "SELECT id, content_markdown FROM lesson_examples WHERE node_id = ? ORDER BY created_at"
    )
    .all("node") as Array<{ id: string; content_markdown: string }>;
  assert(
    listed.length === 2 && listed[0].content_markdown === "Example A",
    "worked examples should be listed in creation order"
  );

  sqlite
    .prepare("UPDATE lesson_examples SET content_markdown = ? WHERE id = ?")
    .run("Updated example", "example-1");
  sqlite.prepare("DELETE FROM lesson_examples WHERE id = ?").run("example-2");
  const afterChanges = sqlite
    .prepare("SELECT content_markdown FROM lesson_examples WHERE node_id = ?")
    .all("node") as Array<{ content_markdown: string }>;
  assert(
    afterChanges.length === 1 &&
      afterChanges[0].content_markdown === "Updated example",
    "worked examples should support update and delete"
  );

  sqlite.prepare("DELETE FROM nodes WHERE id = ?").run("node");
  const afterCascade = sqlite
    .prepare("SELECT id FROM lesson_examples WHERE node_id = ?")
    .all("node");
  assert(afterCascade.length === 0, "node deletion should cascade to its examples");
  const edgesAfterCascade = sqlite
    .prepare("SELECT source_id FROM edges WHERE source_id = ? OR target_id = ?")
    .all("node", "node");
  assert(
    edgesAfterCascade.length === 0,
    "node deletion should cascade to incident prerequisite edges"
  );

  sqlite.close();
  console.log("✓ SQLite v7 layout-mode and worked-example migration tests passed!");
}

run().catch((error) => {
  console.error("Worked-example database tests failed:", error);
  process.exitCode = 1;
});
