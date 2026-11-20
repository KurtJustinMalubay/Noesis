import { useEffect, useState } from "react";

export function scheduleDebouncedValue<T>(
  value: T,
  delayMs: number,
  onValue: (value: T) => void
): () => void {
  const timer = setTimeout(() => onValue(value), delayMs);
  return () => clearTimeout(timer);
}

export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    return scheduleDebouncedValue(value, delayMs, setDebouncedValue);
  }, [delayMs, value]);

  return debouncedValue;
}
