import { setTimeout as wait } from "node:timers/promises";
import { scheduleDebouncedValue } from "../src/hooks/useDebouncedValue.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function run(): Promise<void> {
  const values: string[] = [];
  const cancelFirst = scheduleDebouncedValue("first", 400, (value) =>
    values.push(value)
  );
  await wait(100);
  cancelFirst();
  scheduleDebouncedValue("latest", 400, (value) => values.push(value));

  await wait(399);
  assert(values.length === 0, "typing pauses shorter than 400ms should not fire");
  await wait(30);
  assert(
    values.length === 1 && values[0] === "latest",
    "only the latest value should fire once the 400ms pause elapses"
  );
  console.log("✓ 400ms debounce behavior tests passed!");
}

run().catch((error) => {
  console.error("Debounce tests failed:", error);
  process.exitCode = 1;
});
