import { strict as assert } from "node:assert";
import {
  buildMultiRowInsert,
  executeBatch,
} from "../src/db/batch.ts";
import { serializeDbWrite } from "../src/db/writeQueue.ts";
import { runMigrations } from "../src/db/migrations.ts";

async function run(): Promise<void> {
  const rows = Array.from({ length: 123 }, (_, index) => [
    "doc-id",
    index,
    null,
    `Chunk ${index}`,
  ]);
  const batches = buildMultiRowInsert(
    "doc_chunks",
    ["doc_id", "chunk_index", "heading", "content"],
    rows
  );

  assert.deepEqual(
    batches.map((batch) => batch.params.length),
    [200, 200, 92],
    "chunk inserts should use batches of up to 50 rows"
  );
  assert(
    batches.every((batch) => batch.params.length <= 999),
    "batch inserts must stay below SQLite's parameter limit"
  );
  assert(
    batches[0].sql.includes("($1, $2, $3, $4)") &&
      batches[0].sql.includes("($197, $198, $199, $200)"),
    "placeholders should be sequential within each batch"
  );
  assert.deepEqual(
    buildMultiRowInsert("doc_chunks", ["doc_id"], []),
    [],
    "empty inserts should produce no statements"
  );
  assert.throws(
    () => buildMultiRowInsert("doc_chunks", ["doc_id"], [["a", "b"]]),
    "rows with a mismatched column count should be rejected"
  );

  const events: string[] = [];
  let activeWrites = 0;
  let maximumConcurrentWrites = 0;
  const write = (name: string) =>
    serializeDbWrite(async () => {
      activeWrites++;
      maximumConcurrentWrites = Math.max(
        maximumConcurrentWrites,
        activeWrites
      );
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`${name}:end`);
      activeWrites--;
    });

  await Promise.all([write("first"), write("second"), write("third")]);
  assert.equal(maximumConcurrentWrites, 1, "writes must run serially");
  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
    "third:start",
    "third:end",
  ]);
  await assert.rejects(
    serializeDbWrite(async () => {
      throw new Error("expected write failure");
    }),
    /expected write failure/
  );
  let queueRecovered = false;
  await serializeDbWrite(async () => {
    queueRecovered = true;
  });
  assert(queueRecovered, "a failed write must not block later queued writes");

  const statements: string[] = [];
  const fakeDatabase = {
    execute: async (sql: string) => {
      statements.push(sql);
      return { rowsAffected: 1 };
    },
  } as unknown as Parameters<typeof executeBatch>[0];
  await executeBatch(fakeDatabase, "UPDATE nodes SET status = $1 WHERE id = $2", [
    ["mastered", "node-1"],
    ["unlocked", "node-2"],
  ]);
  assert.deepEqual(
    statements,
    [
      "UPDATE nodes SET status = $1 WHERE id = $2",
      "UPDATE nodes SET status = $1 WHERE id = $2",
    ],
    "batch updates should run without separate transaction-control statements"
  );

  const migrationStatements: string[] = [];
  const fakeMigrationDatabase = {
    execute: async (sql: string) => {
      migrationStatements.push(sql);
      return { rowsAffected: 1 };
    },
    select: async (sql: string) => {
      if (sql.includes("user_version")) return [{ user_version: 0 }];
      if (sql.includes("table_info(tutor_threads)")) {
        return [
          { name: "rolling_summary" },
          { name: "summary_cursor_created_at" },
          { name: "summary_cursor_id" },
        ];
      }
      return [];
    },
  } as unknown as Parameters<typeof runMigrations>[0];
  await runMigrations(fakeMigrationDatabase);
  const migrationSql = migrationStatements.join("\n");
  assert(
    migrationStatements.some((sql) => sql.includes("PRAGMA temp_store = MEMORY")) &&
      migrationStatements.some((sql) => sql.includes("PRAGMA cache_size = -16000")),
    "SQLite should configure memory temp storage and a bounded page cache"
  );
  assert(
    migrationSql.includes("idx_nodes_workspace_layer") &&
    migrationSql.includes("idx_nodes_workspace_archived") &&
      migrationSql.includes("idx_flashcards_next_review") &&
      migrationSql.includes("idx_tutor_messages_thread_seq") &&
      migrationSql.includes("idx_plugin_boards_scope") &&
      migrationSql.includes("CREATE TABLE IF NOT EXISTS plugin_boards") &&
      migrationSql.includes("ALTER TABLE workspaces ADD COLUMN archived_at") &&
      migrationSql.includes("ALTER TABLE nodes ADD COLUMN archived_at") &&
      migrationSql.includes("rolling_summary TEXT") &&
      migrationSql.includes("node_quizzes ADD COLUMN updated_at") &&
      migrationSql.includes("node_quizzes ADD COLUMN config_json") &&
      migrationSql.includes("node_quizzes ADD COLUMN draft_json") &&
      migrationSql.includes("node_quizzes ADD COLUMN score"),
    "schema should create performance indexes, rolling tutor memory, plugin boards, and quiz persistence fields"
  );
  assert(
    !migrationStatements.some((sql) => /^\s*(BEGIN|COMMIT)\b/i.test(sql)),
    "schema migration writes must not add connection-scoped transactions"
  );
  const upgradeStatements: string[] = [];
  const upgradeDatabase = {
    execute: async (sql: string) => {
      upgradeStatements.push(sql);
      return { rowsAffected: 1 };
    },
    select: async (sql: string) => {
      if (sql.includes("user_version")) return [{ user_version: 2 }];
      if (sql.includes("table_info(tutor_threads)")) {
        return [
          { name: "id" },
          { name: "workspace_id" },
          { name: "node_id" },
          { name: "title" },
          { name: "updated_at" },
        ];
      }
      return [];
    },
  } as unknown as Parameters<typeof runMigrations>[0];
  await runMigrations(upgradeDatabase);
  assert(
    upgradeStatements.some((sql) =>
      sql.includes("ALTER TABLE tutor_threads ADD COLUMN rolling_summary")
    ) &&
      upgradeStatements.some((sql) =>
        sql.includes("ALTER TABLE tutor_threads ADD COLUMN summary_cursor_id")
      ),
    "existing tutor databases should gain rolling-memory columns safely"
  );
  console.log("✓ SQLite insert batching and write serialization tests passed!");
}

run().catch((error) => {
  console.error("Database batching test failed:", error);
  process.exitCode = 1;
});
