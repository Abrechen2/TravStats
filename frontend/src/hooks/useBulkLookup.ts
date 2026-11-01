import { useCallback, useRef, useState } from "react";
import { lookupFlightsBatched, type LookupOutcome, type LookupRow } from "../lib/flightLookupBatch";

export interface BulkLookupState<T> {
  outcomes: ReadonlyMap<string, LookupOutcome<T>>;
  running: boolean;
  progress: { done: number; total: number } | null;
  run: (rows: readonly LookupRow[]) => Promise<void>;
}

/** `lookupFlightsBatched` as component state; a second run replaces the first's answers. */
export function useBulkLookup<T>(): BulkLookupState<T> {
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, LookupOutcome<T>>>(new Map());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const active = useRef(false);

  const run = useCallback(async (rows: readonly LookupRow[]): Promise<void> => {
    if (active.current) return;
    active.current = true;
    setRunning(true);
    setOutcomes(new Map());
    setProgress({ done: 0, total: rows.length });
    try {
      setOutcomes(
        await lookupFlightsBatched<T>(rows, (done, total) => setProgress({ done, total }))
      );
    } finally {
      active.current = false;
      setRunning(false);
    }
  }, []);

  return { outcomes, running, progress, run };
}
