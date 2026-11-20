import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";

export interface LessonExample {
  id: string;
  node_id: string;
  user_prompt: string;
  tools_json: string;
  content_markdown: string;
  created_at: string;
}

export async function listLessonExamples(nodeId: string): Promise<LessonExample[]> {
  const db = await getDb();
  return db.select<LessonExample[]>(
    "SELECT id, node_id, user_prompt, tools_json, content_markdown, created_at FROM lesson_examples WHERE node_id = $1 ORDER BY created_at ASC",
    [nodeId]
  );
}

export async function saveLessonExample(
  example: LessonExample
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `INSERT INTO lesson_examples
        (id, node_id, user_prompt, tools_json, content_markdown, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        example.id,
        example.node_id,
        example.user_prompt,
        example.tools_json,
        example.content_markdown,
        example.created_at,
      ]
    )
  );
}

export async function updateLessonExample(
  example: Pick<LessonExample, "id" | "user_prompt" | "tools_json" | "content_markdown">
): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute(
      `UPDATE lesson_examples
       SET user_prompt = $1, tools_json = $2, content_markdown = $3
       WHERE id = $4`,
      [
        example.user_prompt,
        example.tools_json,
        example.content_markdown,
        example.id,
      ]
    )
  );
}

export async function deleteLessonExample(id: string): Promise<void> {
  const db = await getDb();
  await serializeDbWrite(() =>
    db.execute("DELETE FROM lesson_examples WHERE id = $1", [id])
  );
}
