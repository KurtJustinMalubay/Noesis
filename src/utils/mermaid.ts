type Mermaid = typeof import("mermaid").default;

let mermaidQueue: Promise<void> = Promise.resolve();

export function queueMermaidTask<T>(
  operation: (mermaid: Mermaid) => Promise<T>
): Promise<T> {
  const result = mermaidQueue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    return operation(mermaid);
  });
  mermaidQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function validateMermaidDiagram(code: string): Promise<void> {
  return queueMermaidTask(async (mermaid) => {
    const parsed = await mermaid.parse(code, { suppressErrors: false });
    if (!parsed) throw new Error("Mermaid did not recognize the diagram.");
  });
}
