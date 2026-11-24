import type Database from "@tauri-apps/plugin-sql";

const CURRENT_SCHEMA_VERSION = 13;

export async function runMigrations(db: Database): Promise<void> {
  await db.execute("PRAGMA journal_mode = WAL;");
  await db.execute("PRAGMA foreign_keys = ON;");
  await db.execute("PRAGMA synchronous = NORMAL;");
  await db.execute("PRAGMA temp_store = MEMORY;");
  await db.execute("PRAGMA cache_size = -16000;");

  const rows = await db.select<Array<{ user_version: number }>>(
    "PRAGMA user_version;"
  );
  const currentVersion = rows[0]?.user_version ?? 0;

  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    return;
  }

  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        root_domain TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      );
    `);
    const workspaceColumns = await db.select<Array<{ name: string }>>(
      "PRAGMA table_info(workspaces);"
    );
    if (!workspaceColumns.some((column) => column.name === "layout_mode")) {
      await db.execute(
        "ALTER TABLE workspaces ADD COLUMN layout_mode TEXT NOT NULL DEFAULT 'auto';"
      );
    }
    if (!workspaceColumns.some((column) => column.name === "archived_at")) {
      await db.execute(
        "ALTER TABLE workspaces ADD COLUMN archived_at INTEGER;"
      );
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary_hint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'locked',
        mastery_score REAL NOT NULL DEFAULT 0.0,
        in_degree_unmastered INTEGER NOT NULL DEFAULT 0,
        layer_index INTEGER NOT NULL DEFAULT 0,
        pos_x REAL NOT NULL DEFAULT 0,
        pos_y REAL NOT NULL DEFAULT 0,
        is_hydrated INTEGER NOT NULL DEFAULT 0,
        lesson_markdown TEXT,
        mermaid_diagram TEXT,
        source_citations TEXT,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      );
    `);

    const nodeColumns = await db.select<Array<{ name: string }>>(
      "PRAGMA table_info(nodes);"
    );
    if (!nodeColumns.some((column) => column.name === "archived_at")) {
      await db.execute("ALTER TABLE nodes ADD COLUMN archived_at INTEGER;");
    }
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_nodes_workspace ON nodes(workspace_id);"
    );
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_nodes_workspace_archived ON nodes(workspace_id, archived_at);"
    );
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_nodes_workspace_layer ON nodes(workspace_id, layer_index);"
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS edges (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        PRIMARY KEY (source_id, target_id)
      );
    `);

    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_edges_workspace ON edges(workspace_id);"
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS flashcards (
        id TEXT PRIMARY KEY NOT NULL,
        node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        ease_factor REAL NOT NULL DEFAULT 2.5,
        interval_days INTEGER NOT NULL DEFAULT 0,
        repetitions INTEGER NOT NULL DEFAULT 0,
        next_review_at INTEGER NOT NULL
      );
    `);

    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_flashcards_due ON flashcards(node_id, next_review_at);"
    );
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_flashcards_next_review ON flashcards(next_review_at);"
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS node_quizzes (
        node_id TEXT PRIMARY KEY NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        quiz_type TEXT NOT NULL,
        questions_json TEXT NOT NULL,
        best_score REAL NOT NULL DEFAULT 0.0,
        attempt_count INTEGER NOT NULL DEFAULT 0
      );
    `);

    const quizColumns = await db.select<Array<{ name: string }>>(
      "PRAGMA table_info(node_quizzes);"
    );
    const quizColumnNames = new Set(quizColumns.map((column) => column.name));
    for (const [name, definition] of [
      ["updated_at", "INTEGER NOT NULL DEFAULT 0"],
      ["config_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["draft_json", "TEXT NOT NULL DEFAULT '{}'"],
      ["score", "REAL"],
    ]) {
      if (!quizColumnNames.has(name)) {
        await db.execute(
          `ALTER TABLE node_quizzes ADD COLUMN ${name} ${definition};`
        );
      }
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        file_name TEXT NOT NULL,
        file_hash TEXT UNIQUE NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS document_workspaces (
        doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        PRIMARY KEY (doc_id, workspace_id)
      );
    `);
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_document_workspaces_workspace ON document_workspaces(workspace_id);"
    );
    await db.execute(`
      INSERT OR IGNORE INTO document_workspaces (doc_id, workspace_id)
      SELECT id, workspace_id FROM documents WHERE workspace_id IS NOT NULL;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS doc_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        heading TEXT,
        content TEXT NOT NULL
      );
    `);

    await db.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(
        heading,
        content,
        content='doc_chunks',
        content_rowid='id',
        tokenize='porter unicode61'
      );
    `);

    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS trg_doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
        INSERT INTO doc_chunks_fts(rowid, heading, content)
        VALUES (new.id, new.heading, new.content);
      END;
    `);

    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS trg_doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
        INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, heading, content)
        VALUES ('delete', old.id, old.heading, old.content);
      END;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS tutor_threads (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        rolling_summary TEXT NOT NULL DEFAULT '',
        summary_cursor_created_at INTEGER,
        summary_cursor_id TEXT
      );
    `);

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_tutor_threads_workspace_updated
      ON tutor_threads(workspace_id, updated_at DESC);
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS tutor_messages (
        id TEXT PRIMARY KEY NOT NULL,
        thread_id TEXT NOT NULL REFERENCES tutor_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        attached_lesson_title TEXT,
        citations_json TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_tutor_messages_thread_seq
      ON tutor_messages(thread_id, created_at DESC, id DESC);
    `);

    const tutorThreadColumns = await db.select<Array<{ name: string }>>(
      "PRAGMA table_info(tutor_threads);"
    );
    const threadColumnNames = new Set(
      tutorThreadColumns.map((column) => column.name)
    );
    if (!threadColumnNames.has("rolling_summary")) {
      await db.execute(
        "ALTER TABLE tutor_threads ADD COLUMN rolling_summary TEXT NOT NULL DEFAULT '';"
      );
    }
    if (!threadColumnNames.has("summary_cursor_created_at")) {
      await db.execute(
        "ALTER TABLE tutor_threads ADD COLUMN summary_cursor_created_at INTEGER;"
      );
    }
    if (!threadColumnNames.has("summary_cursor_id")) {
      await db.execute(
        "ALTER TABLE tutor_threads ADD COLUMN summary_cursor_id TEXT;"
      );
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS lesson_examples (
        id TEXT PRIMARY KEY NOT NULL,
        node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        user_prompt TEXT NOT NULL DEFAULT '',
        tools_json TEXT NOT NULL DEFAULT '[]',
        content_markdown TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_lesson_examples_node ON lesson_examples(node_id, created_at);"
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS plugin_boards (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        plugin_id TEXT NOT NULL,
        node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        scene_json TEXT NOT NULL DEFAULT '{"elements":[],"appState":{},"files":{}}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_opened_at INTEGER NOT NULL
      );
    `);
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_plugin_boards_scope ON plugin_boards(workspace_id, plugin_id, node_id);"
    );

    await db.execute(`
      CREATE TABLE IF NOT EXISTS curriculum_trees (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS curriculum_tree_nodes (
        id TEXT PRIMARY KEY NOT NULL,
        tree_id TEXT NOT NULL REFERENCES curriculum_trees(id) ON DELETE CASCADE,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        summary_hint TEXT NOT NULL DEFAULT '',
        layer_index INTEGER NOT NULL DEFAULT 0
      );
    `);
    await db.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_tree_workspace ON curriculum_tree_nodes(tree_id, workspace_id) WHERE workspace_id IS NOT NULL;"
    );
    await db.execute(`
      CREATE TABLE IF NOT EXISTS curriculum_tree_edges (
        tree_id TEXT NOT NULL REFERENCES curriculum_trees(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES curriculum_tree_nodes(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES curriculum_tree_nodes(id) ON DELETE CASCADE,
        PRIMARY KEY (tree_id, source_id, target_id),
        CHECK (source_id != target_id)
      );
    `);
    await db.execute(
      "CREATE INDEX IF NOT EXISTS idx_curriculum_tree_nodes_tree ON curriculum_tree_nodes(tree_id, layer_index);"
    );
    const treeColumns = await db.select<Array<{ name: string }>>(
      "PRAGMA table_info(curriculum_trees);"
    );
    if (!treeColumns.some((column) => column.name === "layout_mode")) {
      await db.execute(
        "ALTER TABLE curriculum_trees ADD COLUMN layout_mode TEXT NOT NULL DEFAULT 'auto' CHECK(layout_mode IN ('auto', 'free'));"
      );
    }
    if (!treeColumns.some((column) => column.name === "archived_at")) {
      await db.execute(
        "ALTER TABLE curriculum_trees ADD COLUMN archived_at INTEGER;"
      );
    }
    const treeNodeColumns = await db.select<Array<{ name: string }>>(
      "PRAGMA table_info(curriculum_tree_nodes);"
    );
    if (!treeNodeColumns.some((column) => column.name === "pos_x")) {
      await db.execute(
        "ALTER TABLE curriculum_tree_nodes ADD COLUMN pos_x REAL NOT NULL DEFAULT 0;"
      );
    }
    if (!treeNodeColumns.some((column) => column.name === "pos_y")) {
      await db.execute(
        "ALTER TABLE curriculum_tree_nodes ADD COLUMN pos_y REAL NOT NULL DEFAULT 0;"
      );
    }

    await db.execute(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION};`);
  } catch (err) {
    throw err;
  }
}