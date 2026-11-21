import type { Stop } from "../legs";
import { STEP_M, STOP_MS } from "../dayMovement";
import { explanation } from "../../locationEvidence/envelope";
import type { Explanation } from "../../locationEvidence/types";
import type { VisitPick } from "./resolve";

/**
 * Which derived stops may become a place-visit suggestion, and what the
 * suggestion says about the stop (forgejo#316 slice 2, spec 2026-11-20
 * travtrack-visit-detection, V2).
 *
 * The stop's own rule is `legs/stops.ts` (`STOP_MS`, `STEP_M`) and is NOT
 * changed here: whether 15 minutes catches a drive-in is measured on real
 * tracks first (spec Q2), which is why every considered stop's duration is
 * handed back (`stopMinutes`) and logged.
 */

type Span = { fromMs: number; untilMs: number };

/**
 * The stops of a day that may be asked about. A stop the owner dismissed and
 * one already named (accepted, fixed place, lodging, folded into one) are left
 * alone. A stop a stay finding already points at (`stayRef`) stays a candidate
 * on purpose: the run matches it to that finding by time and place, which
 * extends a pending one that the stop outgrew and lets a rejected one keep it
 * from coming back, without a lookup.
 */
export function visitStopsOf(whole: readonly Stop[], window: Span): Stop[] {
  return whole.filter(
    (s) =>
      s.untilMs > window.fromMs &&
      s.fromMs < window.untilMs &&
      !s.dismissed &&
      s.place === null &&
      s.folded === null
  );
}

/** Observed and assumed time of a stop, in milliseconds; they add up to its duration. */
export function stopTimes(stop: Stop): {
  durationMs: number;
  observedMs: number;
  inferredMs: number;
} {
  const durationMs = stop.untilMs - stop.fromMs;
  const inferredMs = Math.min(durationMs, stop.coverage?.inferredMs ?? 0);
  return { durationMs, observedMs: durationMs - inferredMs, inferredMs };
}

const minutes = (ms: number) => Math.round(ms / 60_000);

/** What a visit finding carries beyond a plain stay's evidence: the stop and the venue chosen. */
export function visitEvidence(
  stop: Stop,
  pick: VisitPick,
  lookup: { geocoder: string; venues: string },
  readCoverage: "complete" | "truncated"
) {
  const t = stopTimes(stop);
  const gaps = stop.coverage?.gaps.length ?? 0;
  const expl: Explanation = explanation("stay.stop", {
    minutes: minutes(t.durationMs),
    observedMinutes: minutes(t.observedMs),
    inferredMinutes: minutes(t.inferredMs),
    radiusM: STEP_M,
    distanceM: pick.distanceM,
  });
  return {
    source: "travtrack" as const,
    kind: "stay" as const,
    visit: {
      durationMs: t.durationMs,
      observedMs: t.observedMs,
      inferredMs: t.inferredMs,
      gaps,
      minimumStopMs: STOP_MS,
      distanceM: pick.distanceM,
      venue: {
        name: pick.name,
        source: pick.source,
        osmRef: pick.osmRef,
        type: pick.type,
        category: pick.category,
        isArea: pick.isArea,
        resolved: pick.resolved,
      },
      alternatives: pick.alternatives,
      lookup,
    },
    matchingVisitId: null,
    maxGapMinutes: 0,
    uncertainties: t.inferredMs > 0 ? ["stopInferred"] : [],
    readCoverage,
    explanation: expl,
  };
}
