import { useCallback, useRef, useState } from "react";
import { trackErrorKey, travTrackApi, type TravTrackDay } from "../../../lib/api/travtrack";
import { logger } from "../../../lib/logger";
import { localDay } from "../../../shared/time";
import type { TrackSelection } from "./trackLegs";

/**
 * Picking a leg or a stop on a long span (month, year, Zeitraum). The range
 * read carries neither — shipping every leg's figures for a year would be most
 * of the payload — so a click names an instant, the day of that instant is
 * read, and the leg that holds the instant is the pick; with no leg there, the
 * stop that holds it (the points recorded while standing still are on the same
 * line). Only the day that was clicked is ever read. A failed read, or a click
 * on neither, says so instead of doing nothing.
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
      // A dismissed stop is not drawn on a day either.
      const stop = leg
        ? undefined
        : (read.stops ?? []).find((s) => !s.dismissed && s.fromMs <= atMs && atMs <= s.untilMs);
      const selection: TrackSelection | null = leg
        ? { kind: "leg", date: read.date, id: leg.id }
        : stop
          ? { kind: "stop", date: read.date, fromMs: stop.fromMs }
          : null;
      if (!selection) {
        setState({ kind: "none" });
        return;
      }
      setDay(read);
      setState({ kind: "idle" });
      onSelect(selection);
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
