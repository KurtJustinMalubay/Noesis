let generationQueue: Promise<void> = Promise.resolve();

export function serializeLessonGeneration<T>(
  operation: () => Promise<T>
): Promise<T> {
  const result = generationQueue.then(operation, operation);
  generationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
