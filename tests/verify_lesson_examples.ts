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
    CREATE TABLE documents (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      file_hash TEXT UNIQUE NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    INSERT INTO documents (id, workspace_id, file_name, file_hash, page_count, created_at)
      VALUES ('legacy-document', 'legacy-workspace', 'notes.txt', 'legacy-hash', 1, 1);
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
  assert(version.user_version === 10, "migrations should advance the schema to v10");
  const legacyDocumentLink = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM document_workspaces WHERE doc_id = ? AND workspace_id = ?"
    )
    .get("legacy-document", "legacy-workspace") as { count: number };
  assert(
    legacyDocumentLink.count === 1,
    "existing workspace documents should migrate into the sharing table"
  );
  const pluginBoardColumns = sqlite
    .prepare("PRAGMA table_info(plugin_boards)")
    .all() as Array<{ name: string; notnull: number }>;
  assert(
    pluginBoardColumns.some(
      (column) => column.name === "scene_json" && column.notnull === 1
    ),
    "plugin boards should persist serialized scene data"
  );
  const pluginBoardIndex = sqlite
    .prepare("PRAGMA index_list(plugin_boards)")
    .all() as Array<{ name: string }>;
  assert(
    pluginBoardIndex.some((index) => index.name === "idx_plugin_boards_scope"),
    "plugin boards should have a scope lookup index"
  );
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
  assert(
    workspaceColumns.some((column) => column.name === "archived_at"),
    "workspaces should support recoverable archiving"
  );
  sqlite
    .prepare("UPDATE workspaces SET archived_at = ? WHERE id = ?")
    .run(2000, "legacy-workspace");
  const archivedWorkspaceCount = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM workspaces WHERE archived_at IS NOT NULL"
    )
    .get() as { count: number };
  const activeWorkspaceCount = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM workspaces WHERE archived_at IS NULL"
    )
    .get() as { count: number };
  assert(
    archivedWorkspaceCount.count === 1 && activeWorkspaceCount.count === 0,
    "archiving a workspace should retain it without listing it as active"
  );
  sqlite
    .prepare("UPDATE workspaces SET archived_at = NULL WHERE id = ?")
    .run("legacy-workspace");
  assert(
    (sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM workspaces WHERE archived_at IS NULL"
      )
      .get() as { count: number }).count === 1,
    "restoring a workspace should make it active again"
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
      "INSERT OR IGNORE INTO document_workspaces (doc_id, workspace_id) VALUES (?, ?)"
    )
    .run("legacy-document", "workspace");
  const sharedDocumentCount = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM documents d
       WHERE d.workspace_id = ? OR d.workspace_id IS NULL OR EXISTS (
         SELECT 1 FROM document_workspaces dw
         WHERE dw.doc_id = d.id AND dw.workspace_id = ?
       )`
    )
    .get("workspace", "workspace") as { count: number };
  assert(
    sharedDocumentCount.count === 1,
    "a deduplicated document should be visible to each linked workspace"
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
  sqlite
    .prepare(
      `INSERT INTO plugin_boards
        (id, workspace_id, plugin_id, node_id, title, scene_json,
         created_at, updated_at, last_opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "workspace-board",
      "workspace",
      "excalidraw",
      null,
      "Workspace board",
      '{"elements":[],"appState":{},"files":{}}',
      1,
      1,
      1
    );
  sqlite
    .prepare(
      `INSERT INTO plugin_boards
        (id, workspace_id, plugin_id, node_id, title, scene_json,
         created_at, updated_at, last_opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "node-board",
      "workspace",
      "excalidraw",
      "node",
      "Concept board",
      '{"elements":[],"appState":{},"files":{}}',
      1,
      1,
      1
    );
  const customNode = sqlite
    .prepare("SELECT title, is_hydrated FROM nodes WHERE id = ?")
    .get("custom-node") as { title: string; is_hydrated: number };
  assert(
    customNode.title === "Custom concept" && customNode.is_hydrated === 0,
    "migrated node schema should support unhydrated custom concepts"
  );
  const nodeArchiveColumn = sqlite
    .prepare("PRAGMA table_info(nodes)")
    .all() as Array<{ name: string }>;
  assert(
    nodeArchiveColumn.some((column) => column.name === "archived_at"),
    "nodes should support recoverable archiving"
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

  sqlite
    .prepare("UPDATE nodes SET archived_at = ? WHERE id = ?")
    .run(3000, "node");
  assert(
    (sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM nodes WHERE workspace_id = ? AND archived_at IS NULL"
      )
      .get("workspace") as { count: number }).count === 1,
    "archived concepts should be excluded from the active workspace graph"
  );
  assert(
    (sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM edges e
         JOIN nodes source ON source.id = e.source_id
         JOIN nodes target ON target.id = e.target_id
         WHERE e.workspace_id = ?
           AND source.archived_at IS NULL AND target.archived_at IS NULL`
      )
      .get("workspace") as { count: number }).count === 0 &&
      (sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM plugin_boards b
           LEFT JOIN nodes n ON n.id = b.node_id
           WHERE b.workspace_id = ?
             AND (b.node_id IS NULL OR n.archived_at IS NULL)`
        )
        .get("workspace") as { count: number }).count === 1,
    "archived concept edges and boards should be hidden from active workspace views"
  );
  assert(
    (sqlite
      .prepare("SELECT COUNT(*) AS count FROM lesson_examples WHERE node_id = ?")
      .get("node") as { count: number }).count === 1 &&
      (sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM edges WHERE source_id = ? OR target_id = ?"
        )
        .get("node", "node") as { count: number }).count === 1 &&
      (sqlite
        .prepare("SELECT COUNT(*) AS count FROM plugin_boards WHERE node_id = ?")
        .get("node") as { count: number }).count === 1,
    "archiving a concept should preserve its examples, edges, and board"
  );
  sqlite.prepare("UPDATE nodes SET archived_at = NULL WHERE id = ?").run("node");
  assert(
    (sqlite
      .prepare("SELECT COUNT(*) AS count FROM nodes WHERE id = ? AND archived_at IS NULL")
      .get("node") as { count: number }).count === 1,
    "restoring a concept should make it active again"
  );
  assert(
    (sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM edges e
         JOIN nodes source ON source.id = e.source_id
         JOIN nodes target ON target.id = e.target_id
         WHERE e.workspace_id = ?
           AND source.archived_at IS NULL AND target.archived_at IS NULL`
      )
      .get("workspace") as { count: number }).count === 1,
    "restoring a concept should restore its prerequisite connections"
  );
  sqlite
    .prepare(
      "UPDATE nodes SET archived_at = ? WHERE id = ?"
    )
    .run(4000, "node");
  sqlite
    .prepare("DELETE FROM nodes WHERE id = ? AND archived_at IS NOT NULL")
    .run("node");
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
  const boardsAfterCascade = sqlite
    .prepare("SELECT id FROM plugin_boards ORDER BY id")
    .all() as Array<{ id: string }>;
  assert(
    boardsAfterCascade.length === 1 &&
      boardsAfterCascade[0].id === "workspace-board",
    "node boards should cascade with their concept while workspace boards remain"
  );

  sqlite
    .prepare("DELETE FROM workspaces WHERE id = ?")
    .run("legacy-workspace");
  const sharedAfterOwnerDeletion = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM documents d
       WHERE d.workspace_id = ? OR EXISTS (
         SELECT 1 FROM document_workspaces dw
         WHERE dw.doc_id = d.id AND dw.workspace_id = ?
       ) OR (
         d.workspace_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM document_workspaces dw WHERE dw.doc_id = d.id
         )
       )`
    )
    .get("workspace", "workspace") as { count: number };
  const unrelatedWorkspaceCount = sqlite
    .prepare(
      `SELECT COUNT(*) AS count FROM documents d
       WHERE d.workspace_id = ? OR EXISTS (
         SELECT 1 FROM document_workspaces dw
         WHERE dw.doc_id = d.id AND dw.workspace_id = ?
       ) OR (
         d.workspace_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM document_workspaces dw WHERE dw.doc_id = d.id
         )
       )`
    )
    .get("unrelated", "unrelated") as { count: number };
  assert(
    sharedAfterOwnerDeletion.count === 1 && unrelatedWorkspaceCount.count === 0,
    "sharing should remain workspace-scoped after its original owner is removed"
  );

  sqlite.close();
  console.log("✓ SQLite v10 document sharing and workspace tests passed!");
}

run().catch((error) => {
  console.error("Database migration tests failed:", error);
  process.exitCode = 1;
});
