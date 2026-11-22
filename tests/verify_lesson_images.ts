import {
  extractLessonImageRequest,
  isLessonImageTitleRelevant,
  replaceLessonImageRequest,
} from "../src/ai/lessonImageMarkers.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const lesson = [
  "# Lesson title",
  "An introduction that does not need an image.",
  "## A real-world example",
  "Mount Fuji is an example of a stratovolcano.",
  "[[NOESIS_IMAGE: Mount Fuji stratovolcano Japan]]",
  "This image belongs with the example above.",
  "[[NOESIS_IMAGE: unrelated extra image]]",
].join("\n\n");
const request = extractLessonImageRequest(lesson);
assert(
  request?.query === "Mount Fuji stratovolcano Japan",
  "image requests should preserve a concise subject-specific query"
);
const inserted = replaceLessonImageRequest(
  lesson,
  request?.marker ?? "",
  "![Mount Fuji](https://images.example/mount-fuji.jpg)"
);
assert(
  inserted.indexOf("An introduction") < inserted.indexOf("Mount Fuji is") &&
    inserted.indexOf("Mount Fuji is") < inserted.indexOf("![Mount Fuji]") &&
    inserted.indexOf("![Mount Fuji]") <
      inserted.indexOf("This image belongs with"),
  "lesson images should replace the model marker at its contextual position"
);
assert(
  !inserted.includes("[[NOESIS_IMAGE:"),
  "unselected additional image markers should not leak into lesson text"
);
assert(
  extractLessonImageRequest("# A text-only lesson\n\nNo image is needed.") ===
    null,
  "lessons without an explicit visual request should not trigger image search"
);
assert(
  isLessonImageTitleRelevant(
    "Mount Fuji stratovolcano Japan",
    "File:Mount Fuji from Lake Kawaguchi.jpg"
  ) &&
    !isLessonImageTitleRelevant(
      "Mount Fuji stratovolcano Japan",
      "File:Cat playing with a ball.jpg"
    ),
  "image search should reject results that do not match the requested subject"
);

console.log("✓ Contextual lesson image placement tests passed!");
