import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Loads one thing from one endpoint and keeps it. A load that fails is `failed`
 * (not an empty value), so a row never offers to save over a state it could
 * not read.
 */
export function useLoaded<T>(load: () => Promise<T>): {
  data: T | null;
  setData: (next: T) => void;
  failed: boolean;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = useCallback(async (): Promise<void> => {
    try {
      const next = await loadRef.current();
      if (!alive.current) return;
      setData(next);
      setFailed(false);
    } catch {
      if (alive.current) setFailed(true);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, failed, reload };
}
