import { useCallback, useRef, useState } from "react";
import { trackErrorKey, travTrackApi, type TravTrackDay } from "../../../lib/api/travtrack";
import { logger } from "../../../lib/logger";
import { localDay } from "../../../shared/time";
import type { TrackSelection } from "./trackLegs";

/**
 * Picking a leg on a long span (month, year, Zeitraum). The range read carries
 * no legs — shipping every leg's figures for a year would be most of the
 * payload — so a click names an instant, the day of that instant is read, and
 * the leg that holds the instant is the pick. Only the day that was clicked is
 * ever read. A failed read, or a click between two legs, says so instead of
 * doing nothing.
 */
export type RangePickState =
  { kind: "idle" } | { kind: "loading" } | { kind: "failed"; key: string } | { kind: "none" };

export function useRangePick(
  zone: string,
  onSelect: (selection: TrackSelection) => void
): {
  day: TravTrackDay | null;
  state: RangePickState;
  pick: (atMs: number) => Promise<void>;
  reread: (date: string) => Promise<void>;
  clear: () => void;
} {
  const [day, setDay] = useState<TravTrackDay | null>(null);
  const [state, setState] = useState<RangePickState>({ kind: "idle" });
  // A newer click (or a clear) wins over a read still in flight.
  const run = useRef(0);

  const pick = useCallback(
    async (atMs: number) => {
      const id = ++run.current;
      setState({ kind: "loading" });
      let read: TravTrackDay;
      try {
        read = await travTrackApi.day(localDay(atMs, zone));
      } catch (err: unknown) {
        if (id !== run.current) return;
        logger.warn("TravTrack day could not be read for a picked leg", err);
        setState({ kind: "failed", key: trackErrorKey(err) });
        return;
      }
      if (id !== run.current) return;
      const leg = (read.legs ?? []).find((l) => l.fromMs <= atMs && atMs <= l.untilMs);
      if (!leg) {
        setState({ kind: "none" });
        return;
      }
      setDay(read);
      setState({ kind: "idle" });
      onSelect({ kind: "leg", date: read.date, id: leg.id });
    },
    [zone, onSelect]
  );

  const reread = useCallback(async (date: string) => {
    const read = await travTrackApi.day(date);
    setDay((current) => (current?.date === date ? read : current));
  }, []);

  const clear = useCallback(() => {
    run.current++;
    setDay(null);
    setState({ kind: "idle" });
  }, []);

  return { day, state, pick, reread, clear };
}
