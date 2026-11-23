import { invoke } from "@tauri-apps/api/core";
import type { GraphEdge, GraphNode, Workspace } from "../../types/domain";
import { getDb } from "../client";
import { serializeDbWrite } from "../writeQueue";

export async function saveGeneratedWorkspace(
  workspace: Workspace,
  nodes: GraphNode[],
  edges: GraphEdge[]
): Promise<void> {
  await getDb();
  await serializeDbWrite(() =>
    invoke("save_generated_workspace", { workspace, nodes, edges })
  );
}

export async function deleteGeneratedWorkspace(
  workspaceId: string
): Promise<void> {
  await getDb();
  await serializeDbWrite(() =>
    invoke("delete_generated_workspace", { workspaceId })
  );
}
