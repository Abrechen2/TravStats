import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { logger } from "../../../lib/logger";
import { trackErrorKey, travTrackApi } from "../../../lib/api/travtrack";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `?from=` / `?until=` as day strings; anything else is no preset. */
export function useSpanPreset(): { from: string; until: string } {
  const [params] = useSearchParams();
  const from = params.get("from") ?? "";
  const until = params.get("until") ?? "";
  return { from: DAY.test(from) ? from : "", until: DAY.test(until) ? until : "" };
}

export type SpanCount =
  | { kind: "idle" }
  | { kind: "counting" }
  | { kind: "count"; count: number }
  | { kind: "failed"; key: string };

/**
 * How many stored points lie in a span of days — the server's own preview, read
 * from the summary of exactly that span. An invalid or incomplete span counts
 * nothing; a failed read is its own state, never a zero.
 */
export function useSpanCount(from: string, until: string, version = 0): SpanCount {
  const valid = from !== "" && until !== "" && from <= until;
  const [state, setState] = useState<SpanCount>({ kind: "idle" });
  useEffect(() => {
    if (!valid) {
      setState({ kind: "idle" });
      return;
    }
    let live = true;
    setState({ kind: "counting" });
    travTrackApi
      .summary({ fromDay: from, toDay: until })
      .then((s) => {
        if (live) setState({ kind: "count", count: s.pointCount });
      })
      .catch((err: unknown) => {
        logger.warn("TravTrack settings: span count failed", err);
        if (live) setState({ kind: "failed", key: trackErrorKey(err) });
      });
    return () => {
      live = false;
    };
  }, [valid, from, until, version]);
  return state;
}
