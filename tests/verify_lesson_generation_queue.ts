import { serializeLessonGeneration } from "../src/ai/lessonGenerationQueue.ts";

const events: string[] = [];
const first = serializeLessonGeneration(async () => {
  events.push("first-start");
  await new Promise((resolve) => setTimeout(resolve, 10));
  events.push("first-end");
});
const second = serializeLessonGeneration(async () => {
  events.push("second-start");
  events.push("second-end");
});

await Promise.all([first, second]);
if (
  events.join(",") !==
  "first-start,first-end,second-start,second-end"
) {
  throw new Error("Lesson generation should run one job at a time.");
}

console.log("✓ Lesson generation serialization tests passed!");
