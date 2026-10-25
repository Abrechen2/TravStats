import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../../lib/logger";
import { trackErrorKey, travTrackApi } from "../../../lib/api/travtrack";
import { readDays, type DayResult } from "./trackRange";

/**
 * The days of the shown range, read one by one (bounded, `readDays`) and
 * shown as each lands. `refresh(date)` reads one day again — live follow's
 * today — and keeps the day as it was if that read fails, reporting the
 * failure instead of emptying the map.
 */
export function useRangeDays(
  days: readonly string[],
  generation: number
): {
  results: DayResult[];
  refresh: (date: string) => Promise<void>;
} {
  const key = days.join(",");
  const [results, setResults] = useState<DayResult[]>(() =>
    days.map((date) => ({ date, kind: "loading" }))
  );
  const run = useRef(0);

  useEffect(() => {
    const id = ++run.current;
    const list = key.split(",");
    setResults(list.map((date) => ({ date, kind: "loading" })));
    void readDays(
      list,
      (date) => travTrackApi.day(date),
      (err) => {
        logger.warn("TravTrack day could not be loaded", err);
        return trackErrorKey(err);
      },
      (result) => {
        if (id !== run.current) return;
        setResults((prev) => prev.map((r) => (r.date === result.date ? result : r)));
      }
    );
  }, [key, generation]);

  const refresh = useCallback(async (date: string) => {
    const id = run.current;
    const day = await travTrackApi.day(date);
    if (id !== run.current) return;
    setResults((prev) =>
      prev.map((r) => (r.date === date ? { date, kind: "loaded" as const, day } : r))
    );
  }, []);

  return { results, refresh };
}
