use std::ffi::{CStr, CString};
use std::ptr;

unsafe fn exec(db: *mut libsqlite3_sys::sqlite3, sql: &str) -> Result<(), String> {
    let c_sql = CString::new(sql).unwrap();
    let mut err_msg: *mut std::os::raw::c_char = ptr::null_mut();
    let rc = unsafe {
        libsqlite3_sys::sqlite3_exec(
            db,
            c_sql.as_ptr(),
            None,
            ptr::null_mut(),
            &mut err_msg,
        )
    };
    if rc != libsqlite3_sys::SQLITE_OK {
        let err = if !err_msg.is_null() {
            unsafe { CStr::from_ptr(err_msg).to_string_lossy().into_owned() }
        } else {
            format!("Error code {}", rc)
        };
        unsafe { libsqlite3_sys::sqlite3_free(err_msg as *mut _) };
        Err(err)
    } else {
        Ok(())
    }
}

unsafe fn count_rows(db: *mut libsqlite3_sys::sqlite3, sql: &str) -> i32 {
    let mut stmt: *mut libsqlite3_sys::sqlite3_stmt = ptr::null_mut();
    let c_sql = CString::new(sql).unwrap();
    unsafe {
        libsqlite3_sys::sqlite3_prepare_v2(db, c_sql.as_ptr(), -1, &mut stmt, ptr::null_mut());
        assert_eq!(
            libsqlite3_sys::sqlite3_step(stmt),
            libsqlite3_sys::SQLITE_ROW,
            "Query did not return row"
        );
        let count = libsqlite3_sys::sqlite3_column_int(stmt, 0);
        libsqlite3_sys::sqlite3_finalize(stmt);
        count
    }
}

#[test]
fn test_noesis_schema_and_fts5_lifecycle() {
    unsafe {
        let mut db: *mut libsqlite3_sys::sqlite3 = ptr::null_mut();
        let filename = CString::new(":memory:").unwrap();
        let rc = libsqlite3_sys::sqlite3_open(filename.as_ptr(), &mut db);
        assert_eq!(rc, libsqlite3_sys::SQLITE_OK, "Failed to open in-memory SQLite db");

        // 1. Verify PRAGMAs
        exec(db, "PRAGMA journal_mode = WAL;").expect("PRAGMA journal_mode failed");
        exec(db, "PRAGMA foreign_keys = ON;").expect("PRAGMA foreign_keys failed");
        exec(db, "PRAGMA synchronous = NORMAL;").expect("PRAGMA synchronous failed");

        // 2. Full Noesis DDL
        let ddl = "
            CREATE TABLE IF NOT EXISTS workspaces (
              id TEXT PRIMARY KEY NOT NULL,
              title TEXT NOT NULL,
              root_domain TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );

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
              updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_nodes_workspace ON nodes(workspace_id);

            CREATE TABLE IF NOT EXISTS edges (
              workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
              source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
              target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
              PRIMARY KEY (source_id, target_id)
            );

            CREATE INDEX IF NOT EXISTS idx_edges_workspace ON edges(workspace_id);

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

            CREATE INDEX IF NOT EXISTS idx_flashcards_due ON flashcards(node_id, next_review_at);

            CREATE TABLE IF NOT EXISTS node_quizzes (
              node_id TEXT PRIMARY KEY NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
              quiz_type TEXT NOT NULL,
              questions_json TEXT NOT NULL,
              best_score REAL NOT NULL DEFAULT 0.0,
              attempt_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS documents (
              id TEXT PRIMARY KEY NOT NULL,
              workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
              file_name TEXT NOT NULL,
              file_hash TEXT UNIQUE NOT NULL,
              page_count INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS doc_chunks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
              chunk_index INTEGER NOT NULL,
              heading TEXT,
              content TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(
              heading,
              content,
              content='doc_chunks',
              content_rowid='id',
              tokenize='porter unicode61'
            );

            CREATE TRIGGER IF NOT EXISTS trg_doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
              INSERT INTO doc_chunks_fts(rowid, heading, content)
              VALUES (new.id, new.heading, new.content);
            END;

            CREATE TRIGGER IF NOT EXISTS trg_doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
              INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, heading, content)
              VALUES ('delete', old.id, old.heading, old.content);
            END;
        ";
        exec(db, ddl).expect("DDL execution failed");

        // 3. Insert Workspace + Graph Nodes + Edges + Flashcards
        exec(db, "INSERT INTO workspaces (id, title, root_domain, created_at, updated_at)
                  VALUES ('ws-1', 'Automata Theory', 'Computer Science', 1000, 1000);").unwrap();

        exec(db, "INSERT INTO nodes (id, workspace_id, title, summary_hint, status, in_degree_unmastered, layer_index, updated_at)
                  VALUES ('node-1', 'ws-1', 'DFA Fundamentals', 'Deterministic Finite Automata basics', 'unlocked', 0, 0, 1000);").unwrap();

        exec(db, "INSERT INTO nodes (id, workspace_id, title, summary_hint, status, in_degree_unmastered, layer_index, updated_at)
                  VALUES ('node-2', 'ws-1', 'NFA & Equivalence', 'Nondeterministic transitions and subset construction', 'locked', 1, 1, 1000);").unwrap();

        exec(db, "INSERT INTO edges (workspace_id, source_id, target_id)
                  VALUES ('ws-1', 'node-1', 'node-2');").unwrap();

        exec(db, "INSERT INTO flashcards (id, node_id, front, back, ease_factor, interval_days, repetitions, next_review_at)
                  VALUES ('fc-1', 'node-1', 'What is DFA transition function?', 'delta: Q x Sigma -> Q', 2.5, 0, 0, 1000);").unwrap();

        assert_eq!(count_rows(db, "SELECT COUNT(*) FROM nodes WHERE workspace_id = 'ws-1'"), 2);
        assert_eq!(count_rows(db, "SELECT COUNT(*) FROM edges WHERE workspace_id = 'ws-1'"), 1);
        assert_eq!(count_rows(db, "SELECT COUNT(*) FROM flashcards WHERE node_id = 'node-1'"), 1);

        // 4. Ingest Documents and verify FTS5 BM25 search
        exec(db, "INSERT INTO documents (id, workspace_id, file_name, file_hash, page_count, created_at)
                  VALUES ('doc-1', 'ws-1', 'automata_notes.md', 'sha256_mock_hash', 1, 1000);").unwrap();

        exec(db, "INSERT INTO doc_chunks (doc_id, chunk_index, heading, content)
                  VALUES ('doc-1', 0, 'Overview', 'Formal languages, grammars, and regular expressions can be converted into DFAs.');").unwrap();

        exec(db, "INSERT INTO doc_chunks (doc_id, chunk_index, heading, content)
                  VALUES ('doc-1', 1, 'Pumping Lemma', 'The pumping lemma is used to prove that certain languages are not regular.');").unwrap();

        // Check FTS5 retrieval
        assert_eq!(count_rows(db, "SELECT COUNT(*) FROM doc_chunks_fts WHERE doc_chunks_fts MATCH '\"regular\"*'"), 2);
        assert_eq!(count_rows(db, "SELECT COUNT(*) FROM doc_chunks_fts WHERE doc_chunks_fts MATCH '\"pumping\"*'"), 1);

        // 5. Test cascading deletion on Workspace
        exec(db, "DELETE FROM workspaces WHERE id = 'ws-1';").unwrap();
        assert_eq!(count_rows(db, "SELECT COUNT(*) FROM nodes"), 0, "Nodes should cascade delete with workspace");
        assert_eq!(count_rows(db, "SELECT COUNT(*) FROM edges"), 0, "Edges should cascade delete with workspace");
        assert_eq!(count_rows(db, "SELECT COUNT(*) FROM flashcards"), 0, "Flashcards should cascade delete with workspace");

        // 6. Test cascading deletion on Document and FTS5 sync
        exec(db, "DELETE FROM documents WHERE id = 'doc-1';").unwrap();
        assert_eq!(count_rows(db, "SELECT COUNT(*) FROM doc_chunks"), 0, "Doc chunks should cascade delete");
        assert_eq!(count_rows(db, "SELECT COUNT(*) FROM doc_chunks_fts WHERE doc_chunks_fts MATCH '\"regular\"*'"), 0, "FTS5 index should be clean after delete trigger");

        libsqlite3_sys::sqlite3_close(db);
    }
}
