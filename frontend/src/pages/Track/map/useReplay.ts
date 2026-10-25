import { useCallback, useEffect, useMemo, useState } from "react";
import type { TrackPoint } from "../../../lib/api/travtrack";
import {
  advanceReplay,
  REPLAY_RATES,
  replaySpans,
  snapToSpan,
  type ReplayRate,
  type ReplaySpan,
} from "./trackReplay";

/** How often the replay steps, in wall-clock milliseconds. */
export const REPLAY_TICK_MS = 100;

export interface Replay {
  spans: ReplaySpan[];
  /** Where the replay stands; null while it was never started (the whole range is drawn). */
  t: number | null;
  playing: boolean;
  rate: ReplayRate;
  toggle: () => void;
  seek: (t: number) => void;
  setRate: (rate: ReplayRate) => void;
  reset: () => void;
}

/** Plays the shown stretches through, jumping every gap (`advanceReplay`). */
export function useReplay(segments: readonly TrackPoint[][]): Replay {
  const spans = useMemo(() => replaySpans(segments), [segments]);
  const [t, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<ReplayRate>("4x");

  const reset = useCallback(() => {
    setPlaying(false);
    setT(null);
  }, []);

  // New stretches (another range, a refreshed day): the old clock means nothing there.
  useEffect(reset, [spans, reset]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((prev) => {
        const start = prev ?? spans[0]?.fromMs ?? 0;
        const next = advanceReplay(spans, start, REPLAY_RATES[rate] * REPLAY_TICK_MS);
        if (next.done) setPlaying(false);
        return next.t;
      });
    }, REPLAY_TICK_MS);
    return () => clearInterval(id);
  }, [playing, rate, spans]);

  const toggle = useCallback(() => {
    if (spans.length === 0) return;
    setPlaying((p) => {
      if (!p) {
        // A replay at its end starts over.
        setT((prev) =>
          prev === null || prev >= spans[spans.length - 1].untilMs ? spans[0].fromMs : prev
        );
      }
      return !p;
    });
  }, [spans]);

  const seek = useCallback((to: number) => setT(snapToSpan(spans, to)), [spans]);

  return { spans, t, playing, rate, toggle, seek, setRate, reset };
}
