import { useCallback, useEffect, useRef, useState } from "react";
import type { DaySpan } from "../../../lib/api/travtrack";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { travTrackViewsApi, type TravTrackRange } from "../../../lib/api/travtrackViews";
import { logger } from "../../../lib/logger";

/**
 * Monat / Jahr / Zeitraum on the map (TravTrack plan T5.3): the server's range
 * read, one part after the other, each shown as it lands. Parts are kept side
 * by side and never joined — a part's end ends every stretch in it, so the
 * step across a part boundary is not drawn, and nothing here draws it.
 *
 * A failed part keeps what already arrived and says so; `resume` asks for the
 * failed part again from its own cursor instead of starting over.
 */

export type RangeReadState =
  | { kind: "loading"; parts: TravTrackRange[]; progress: number }
  | { kind: "loaded"; parts: TravTrackRange[] }
  | { kind: "failed"; parts: TravTrackRange[]; key: string; progress: number };

/** How far the parts got through the span, 0..1, from the first instant not yet read. */
export function rangeProgress(part: TravTrackRange): number {
  if (!part.next) return 1;
  const from = Date.parse(part.from);
  const to = Date.parse(part.to);
  const next = Date.parse(part.next);
  if (!(to > from)) return 1;
  return Math.min(1, Math.max(0, (next - from) / (to - from)));
}

/** Reads one part after another until the span ends, handing each to `onPart`; throws on a failed part. */
export async function readRangeParts(
  span: DaySpan,
  read: typeof travTrackViewsApi.range,
  onPart: (part: TravTrackRange) => boolean,
  cursor: string | null = null
): Promise<void> {
  let next = cursor;
  do {
    const part = await read(span, next);
    if (!onPart(part)) return;
    next = part.next ? part.cursor : null;
  } while (next);
}

export function useRangeRead(
  span: DaySpan | null,
  generation: number
): { state: RangeReadState | null; resume: () => void } {
  const [state, setState] = useState<RangeReadState | null>(null);
  const run = useRef(0);
  const resumeAt = useRef<string | null>(null);
  const key = span ? `${span.fromDay}|${span.toDay}` : "";

  const start = useCallback(
    (spanToRead: DaySpan, cursor: string | null, keep: TravTrackRange[]) => {
      const id = ++run.current;
      const parts = [...keep];
      setState({
        kind: "loading",
        parts,
        progress: parts.length ? rangeProgress(parts[parts.length - 1]) : 0,
      });
      void readRangeParts(
        spanToRead,
        travTrackViewsApi.range,
        (part) => {
          if (id !== run.current) return false;
          parts.push(part);
          resumeAt.current = part.next ? part.cursor : null;
          setState(
            part.next
              ? { kind: "loading", parts: [...parts], progress: rangeProgress(part) }
              : { kind: "loaded", parts: [...parts] }
          );
          return true;
        },
        cursor
      ).catch((err: unknown) => {
        if (id !== run.current) return;
        logger.warn("TravTrack range part could not be loaded", err);
        setState({
          kind: "failed",
          parts: [...parts],
          key: trackErrorKey(err),
          progress: parts.length ? rangeProgress(parts[parts.length - 1]) : 0,
        });
      });
    },
    []
  );

  useEffect(() => {
    if (!key) {
      run.current++;
      setState(null);
      return;
    }
    const [fromDay, toDay] = key.split("|");
    resumeAt.current = null;
    start({ fromDay, toDay }, null, []);
  }, [key, generation, start]);

  const resume = useCallback(() => {
    if (!key || state?.kind !== "failed") return;
    const [fromDay, toDay] = key.split("|");
    // Nothing arrived yet: start over; otherwise go on from the last part's cursor.
    start({ fromDay, toDay }, state.parts.length ? resumeAt.current : null, state.parts);
  }, [key, state, start]);

  return { state, resume };
}
