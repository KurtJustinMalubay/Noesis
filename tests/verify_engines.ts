import {
  canReach,
  validateAndLayerDag,
  buildInitialGraphNodes,
} from "../src/engine/dagTopology.ts";
import { computeSugiyamaLayout } from "../src/engine/sugiyamaLayout.ts";
import {
  computeMasteryCascade,
  recomputeGraphState,
} from "../src/engine/masteryCascade.ts";
import { scheduleNextReview } from "../src/engine/sm2Scheduler.ts";
import {
  chunkDocumentText,
  computeSha256Hex,
} from "../src/vault/chunker.ts";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

async function testAll() {
  console.log("=== 1. Testing dagTopology (Cycle Breaking & Kahn Topological Sort) ===");
  const emptyDag = validateAndLayerDag("ws-empty", [], []);
  assert(
    emptyDag.orderedNodeIds.length === 0 &&
      emptyDag.validEdges.length === 0 &&
      emptyDag.removedCycleEdges.length === 0 &&
      computeSugiyamaLayout([], []).length === 0,
    "empty graphs should validate and lay out without throwing"
  );
  const singleNodeDag = validateAndLayerDag(
    "ws-single",
    [{ id: "only", title: "Only node", summary_hint: "Single node" }],
    []
  );
  assert(
    singleNodeDag.orderedNodeIds.length === 1 &&
      singleNodeDag.orderedNodeIds[0] === "only" &&
      singleNodeDag.layerByNode.get("only") === 0 &&
      buildInitialGraphNodes(
        "ws-single",
        [{ id: "only", title: "Only node", summary_hint: "Single node" }],
        singleNodeDag
      )[0].status === "unlocked",
    "single-node graphs should form one unlocked layer-zero root"
  );
  const rawNodes = [
    { id: "A", title: "Node A", summary_hint: "Root" },
    { id: "B", title: "Node B", summary_hint: "Branch 1" },
    { id: "C", title: "Node C", summary_hint: "Branch 2" },
    { id: "D", title: "Node D", summary_hint: "Join" },
  ];
  const rawEdges = [
    { source_id: "A", target_id: "B" },
    { source_id: "A", target_id: "C" },
    { source_id: "B", target_id: "D" },
    { source_id: "C", target_id: "D" },
    { source_id: "D", target_id: "A" }, // Back-edge cycle
    { source_id: "A", target_id: "A" }, // Self-loop
  ];

  const validated = validateAndLayerDag("ws-test", rawNodes, rawEdges);
  assert(validated.removedCycleEdges.length === 1, "Should remove exactly 1 cycle edge (D->A)");
  assert(
    validated.removedCycleEdges[0].source_id === "D" &&
      validated.removedCycleEdges[0].target_id === "A",
    "Removed edge should be D->A"
  );
  assert(validated.validEdges.length === 4, "Valid edges should be A->B, A->C, B->D, C->D");
  assert(
    canReach(validated.validEdges, "A", "D") &&
      !canReach(validated.validEdges, "D", "A") &&
      canReach(validated.validEdges, "A", "A"),
    "reachability should find paths and identify self-loops for interactive edge checks"
  );

  assert(validated.layerByNode.get("A") === 0, "A should be layer 0");
  assert(validated.layerByNode.get("B") === 1, "B should be layer 1");
  assert(validated.layerByNode.get("C") === 1, "C should be layer 1");
  assert(validated.layerByNode.get("D") === 2, "D should be layer 2");

  assert(validated.inDegreeByNode.get("A") === 0, "A in-degree should be 0");
  assert(validated.inDegreeByNode.get("B") === 1, "B in-degree should be 1");
  assert(validated.inDegreeByNode.get("C") === 1, "C in-degree should be 1");
  assert(validated.inDegreeByNode.get("D") === 2, "D in-degree should be 2");

  const nodes = buildInitialGraphNodes("ws-test", rawNodes, validated);
  assert(nodes.find((n) => n.id === "A")?.status === "unlocked", "Root A should be unlocked");
  assert(nodes.find((n) => n.id === "B")?.status === "locked", "B should be locked");
  assert(nodes.find((n) => n.id === "C")?.status === "locked", "C should be locked");
  assert(nodes.find((n) => n.id === "D")?.status === "locked", "D should be locked");
  const graphAfterDisconnect = recomputeGraphState(
    nodes,
    validated.validEdges.filter(
      (edge) => !(edge.source_id === "A" && edge.target_id === "B")
    )
  );
  const bAfterDisconnect = graphAfterDisconnect.updatedNodes.find(
    (node) => node.id === "B"
  )!;
  assert(
    bAfterDisconnect.status === "unlocked" &&
      bAfterDisconnect.in_degree_unmastered === 0 &&
      bAfterDisconnect.layer_index === 0,
    "disconnecting the last prerequisite should unlock and re-layer a node"
  );
  console.log("✓ dagTopology tests passed!");

  console.log("=== 2. Testing sugiyamaLayout ===");
  const laidOut = computeSugiyamaLayout(nodes, validated.validEdges);
  assert(laidOut.length === 4, "All 4 nodes laid out");
  const aNode = laidOut.find((n) => n.id === "A")!;
  const bNode = laidOut.find((n) => n.id === "B")!;
  const cNode = laidOut.find((n) => n.id === "C")!;
  const dNode = laidOut.find((n) => n.id === "D")!;
  assert(aNode.pos_y < bNode.pos_y, "A Y should be above B Y");
  assert(bNode.pos_y === cNode.pos_y, "B and C should share Y (same layer)");
  assert(bNode.pos_y < dNode.pos_y, "B Y should be above D Y");
  console.log("✓ sugiyamaLayout tests passed!");

  console.log("=== 3. Testing masteryCascade ===");
  const cascade1 = computeMasteryCascade(nodes, validated.validEdges, "A", 0.95);
  assert(cascade1.newlyUnlockedIds.includes("B"), "B should be unlocked by mastering A");
  assert(cascade1.newlyUnlockedIds.includes("C"), "C should be unlocked by mastering A");
  assert(!cascade1.newlyUnlockedIds.includes("D"), "D should NOT be unlocked yet");

  const cascade2 = computeMasteryCascade(cascade1.updatedNodes, validated.validEdges, "B", 1.0);
  const dAfterB = cascade2.updatedNodes.find((n) => n.id === "D")!;
  assert(dAfterB.in_degree_unmastered === 1, "D in-degree should decrement to 1 after B");
  assert(dAfterB.status === "locked", "D should still be locked");

  const cascade3 = computeMasteryCascade(cascade2.updatedNodes, validated.validEdges, "C", 1.0);
  const dAfterC = cascade3.updatedNodes.find((n) => n.id === "D")!;
  assert(dAfterC.in_degree_unmastered === 0, "D in-degree should decrement to 0 after C");
  assert(dAfterC.status === "unlocked", "D should now be unlocked!");
  assert(cascade3.newlyUnlockedIds.includes("D"), "newlyUnlockedIds should contain D");
  const repeatedCascade = computeMasteryCascade(
    cascade1.updatedNodes,
    validated.validEdges,
    "A",
    0.95,
    new Map(cascade1.updatedNodes.map((node, index) => [node.id, index]))
  );
  assert(
    repeatedCascade.patches.length === 0 &&
      repeatedCascade.updatedNodes === cascade1.updatedNodes,
    "an unchanged mastery result should emit no database patches"
  );
  console.log("✓ masteryCascade tests passed!");

  console.log("=== 3b. Testing large iterative DAG validation ===");
  const longNodes = Array.from({ length: 12000 }, (_, index) => ({
    id: `N${index}`,
    title: `Node ${index}`,
    summary_hint: "",
  }));
  const longEdges = Array.from({ length: longNodes.length - 1 }, (_, index) => ({
    source_id: `N${index}`,
    target_id: `N${index + 1}`,
  }));
  const longDag = validateAndLayerDag("ws-long", longNodes, longEdges);
  assert(
    longDag.orderedNodeIds.length === longNodes.length &&
      longDag.layerByNode.get("N11999") === 11999 &&
      longDag.removedCycleEdges.length === 0,
    "iterative DFS and indexed Kahn traversal should handle deep DAGs"
  );
  console.log("✓ large DAG validation passed!");

  console.log("=== 4. Testing sm2Scheduler ===");
  const initialCard = {
    id: "c1",
    node_id: "A",
    front: "Front",
    back: "Back",
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    next_review_at: 0,
  };

  const now = 1000000;
  const rev1 = scheduleNextReview(initialCard, 2, now);
  assert(rev1.repetitions === 1 && rev1.interval_days === 1, "Repetition 1 check");

  const rev2 = scheduleNextReview(rev1, 2, now);
  assert(rev2.repetitions === 2 && rev2.interval_days === 6, "Repetition 2 check");

  const revFail = scheduleNextReview(rev2, 0, now);
  assert(revFail.repetitions === 0 && revFail.interval_days === 1, "Reset on Again (0)");
  console.log("✓ sm2Scheduler tests passed!");

  console.log("=== 5. Testing chunker & SHA-256 ===");
  const testMarkdown = `# Heading 1\nBody 1\n## Sub 1\nBody 2\n[Page 1]\nBody 3`;
  const chunks = chunkDocumentText(testMarkdown);
  assert(chunks.length === 3, "Expected 3 chunks");
  const largeChunks = chunkDocumentText(
    `${"A".repeat(150000)}\nTAILTOKEN`
  );
  assert(
    largeChunks.length > 100 &&
      largeChunks[largeChunks.length - 1].content.includes("TAILTOKEN"),
    "large sections should chunk progressively without losing their tail"
  );

  const textBytes = new TextEncoder().encode("Deterministic SHA256 test string");
  const hash = await computeSha256Hex(textBytes.buffer);
  assert(typeof hash === "string" && hash.length === 64, "SHA-256 64-char hex");
  console.log("✓ chunker tests passed!");

  console.log("\n>>> ALL ENGINE ARCHITECTURE TESTS PASSED SUCCESSFULLY! <<<");
}

testAll().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
