import { useEffect, useState } from "react";
import type { TrackPoint } from "../../../lib/api/travtrack";
import { trackErrorKey } from "../../../lib/api/travtrack";
import { travTrackViewsApi, type TravTrackRange } from "../../../lib/api/travtrackViews";
import { logger } from "../../../lib/logger";
import { clipStretches, type SectionWindow } from "./sectionGeometry";

/**
 * The privacy-safe stretches of one question's section, read through the
 * Track map's range read (`GET /travtrack/range` with two instants), part
 * after part up to {@link SECTION_MAX_PARTS}. Starts only once `enabled`
 * (the card came into view), so an inbox of forty questions does not read
 * forty spans at once.
 *
 * A failure keeps its own key (TravTrack switched off, network, anything
 * else) so the card can say which; an answer with nothing left in the
 * section is `empty`, not a map of nothing.
 */

/** Parts read for one card; beyond it the section is shown as far as it got, and says so. */
export const SECTION_MAX_PARTS = 3;

export type SectionTrackState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; stretches: TrackPoint[][]; truncated: boolean }
  | { kind: "empty"; truncated: boolean }
  | { kind: "failed"; key: string };

const iso = (ms: number) => new Date(ms).toISOString();

export function useSectionTrack(window: SectionWindow | null, enabled: boolean): SectionTrackState {
  const [state, setState] = useState<SectionTrackState>({ kind: "idle" });
  const fromMs = window?.fromMs ?? null;
  const untilMs = window?.untilMs ?? null;

  useEffect(() => {
    if (!enabled || fromMs === null || untilMs === null || !(untilMs > fromMs)) return;
    let live = true;
    setState({ kind: "loading" });
    const span = { from: iso(fromMs), to: iso(untilMs) };
    void (async () => {
      const parts: TravTrackRange[] = [];
      let cursor: string | null = null;
      try {
        do {
          const part: TravTrackRange = await travTrackViewsApi.range(span, cursor);
          if (!live) return;
          parts.push(part);
          cursor = part.next ? part.cursor : null;
        } while (cursor && parts.length < SECTION_MAX_PARTS);
        const truncated = cursor !== null || parts.some((p) => p.omittedSegments > 0);
        const stretches = clipStretches(parts, { fromMs, untilMs });
        setState(
          stretches.length > 0
            ? { kind: "loaded", stretches, truncated }
            : { kind: "empty", truncated }
        );
      } catch (err: unknown) {
        if (!live) return;
        logger.warn("TravTrack section of an inbox question could not be loaded", err);
        setState({ kind: "failed", key: trackErrorKey(err) });
      }
    })();
    return () => {
      live = false;
    };
  }, [enabled, fromMs, untilMs]);

  return state;
}
