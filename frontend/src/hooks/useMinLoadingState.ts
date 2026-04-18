import { useEffect, useRef, useState } from "react";

// Holds a loader visible for at least `minMs` after it becomes true, so
// fast operations don't flash a loader on and off. When the underlying
// loading flag flips to false early, the hook keeps returning true
// until the minimum has elapsed.

export function useMinLoadingState(isLoading: boolean, minMs = 2000): boolean {
  const [held, setHeld] = useState(isLoading);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) {
      startRef.current = performance.now();
      setHeld(true);
      return;
    }

    if (startRef.current === null) {
      setHeld(false);
      return;
    }

    const elapsed = performance.now() - startRef.current;
    const remaining = Math.max(0, minMs - elapsed);

    if (remaining === 0) {
      startRef.current = null;
      setHeld(false);
      return;
    }

    const timer = setTimeout(() => {
      startRef.current = null;
      setHeld(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, [isLoading, minMs]);

  return held;
}
