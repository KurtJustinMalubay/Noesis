import {
  canReach,
  deduplicateCurriculumEdges,
} from "../src/utils/curriculumDag.ts";
import { summarizeCurriculumProgress } from "../src/utils/curriculumProgress.ts";
import { getUnarchivedWorkspaces } from "../src/utils/workspaceArchive.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const edges = [
  { source_id: "year-1", target_id: "year-2" },
  { source_id: "year-2", target_id: "year-3" },
  { source_id: "year-1", target_id: "elective" },
];

assert(
  deduplicateCurriculumEdges([
    { source_id: "year-1", target_id: "year-2" },
    { source_id: "year-1", target_id: "year-2" },
  ]).length === 1,
  "duplicate generated prerequisites should be ignored"
);
assert(
  canReach(edges, "year-1", "year-3"),
  "prerequisite reachability should include indirect dependencies"
);
assert(
  !canReach(edges, "year-3", "year-1"),
  "reverse reachability should not be inferred"
);
assert(
  !canReach(edges, "elective", "year-3"),
  "unrelated subjects should remain disconnected"
);
assert(
  getUnarchivedWorkspaces([
    { id: "active", archived_at: null },
    { id: "archived", archived_at: 123 },
  ])
    .map((workspace) => workspace.id)
    .join(",") === "active",
  "linked workspaces must be archived before permanent deletion"
);
const progress = summarizeCurriculumProgress(
  ["year-1", "year-2", "year-1"],
  {
    "year-1": { nodeCount: 2, masteredCount: 1 },
    "year-2": { nodeCount: 3, masteredCount: 2 },
    unlinked: { nodeCount: 8, masteredCount: 8 },
  }
);
assert(
  progress.nodeCount === 5 && progress.masteredCount === 3,
  "map progress should aggregate each linked workspace once and exclude unlinked workspaces"
);
console.log("✓ Curriculum prerequisite traversal tests passed!");
