let writeQueue = Promise.resolve();

export function serializeDbWrite<T>(
  operation: () => Promise<T>
): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
