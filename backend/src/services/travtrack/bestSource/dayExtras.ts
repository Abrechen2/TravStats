import type { StoredPoint } from "../../tripRecording/segments";
import { inPrivacyZone } from "../classify";
import type { SafeSpan } from "../readSafe";
import { daySourceSummary, type DaySourceSummary } from "./choices";
import { entryGeometry } from "./entries";
import { LONG_GAP_MS } from "./score";
import { deriveDaySource } from "./store";
import type { Bridge } from "./types";

/**
 * The day view's part of the best-source resolution: which source is used,
 * the lines logged entries draw over explained jumps and gaps, and the long
 * silences drawn dashed as ESTIMATED — never counted, never a route.
 */

export type EstimatedGap = {
  fromMs: number;
  untilMs: number;
  /** `[lat, lon]` of the last fix before and the first after. */
  from: [number, number];
  to: [number, number];
};

export type BridgeLine = Bridge & { coordinates: number[][] };

export type DaySourceExtras = {
  sources: DaySourceSummary;
  estimated: EstimatedGap[];
  bridgeLines: BridgeLine[];
};

/**
 * A straight chord that passes through a privacy circle would draw what the
 * zone hides: the chord's point nearest each circle's centre (on a local flat
 * projection around the centre) is tested, so no circle slips between samples.
 */
export function chordCrossesZone(a: StoredPoint, b: StoredPoint, span: Pick<SafeSpan, "circles">) {
  return span.circles.some((z) => {
    const k = Math.cos((z.lat * Math.PI) / 180);
    const [ax, ay] = [(a[2] - z.lon) * k, a[1] - z.lat];
    const [bx, by] = [(b[2] - z.lon) * k, b[1] - z.lat];
    const [dx, dy] = [bx - ax, by - ay];
    const len2 = dx * dx + dy * dy;
    const f = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const p = { lat: z.lat + ay + dy * f, lon: z.lon + (ax + dx * f) / k };
    return inPrivacyZone(p, [z]);
  });
}

/**
 * The silences longer than `LONG_GAP_MS` between consecutive stretches of the
 * resolved read that nothing else accounts for: not a bridge, not a judged
 * jump, not a deleted span, not a fix the privacy cut removed, and not a
 * chord across a zone.
 */
export function estimatedGaps(
  span: SafeSpan,
  covered: ReadonlyArray<readonly [number, number]>
): EstimatedGap[] {
  const stretches = span.segments.filter((s) => s.length > 0).sort((x, y) => x[0][0] - y[0][0]);
  const out: EstimatedGap[] = [];
  const blocked = [...covered, ...span.deleted.map((d) => [d.fromMs, d.untilMs] as const)];
  for (let k = 1; k < stretches.length; k++) {
    const a = stretches[k - 1][stretches[k - 1].length - 1];
    const b = stretches[k][0];
    if (b[0] - a[0] <= LONG_GAP_MS) continue;
    if (blocked.some(([f, u]) => f < b[0] && u > a[0])) continue;
    if ((span.removedAtMs ?? []).some((t) => t > a[0] && t < b[0])) continue;
    if (chordCrossesZone(a, b, span)) continue;
    out.push({ fromMs: a[0], untilMs: b[0], from: [a[1], a[2]], to: [b[1], b[2]] });
  }
  return out;
}

/** Resolves the day first when the paced run has not reached it: one bounded day. */
export async function ensureDayResolved(userId: string, date: string): Promise<void> {
  const summary = await daySourceSummary(userId, date);
  if (!summary.scored) await deriveDaySource(userId, date);
}

export async function daySourceExtras(
  userId: string,
  date: string,
  read: SafeSpan
): Promise<DaySourceExtras> {
  const sources = await daySourceSummary(userId, date);
  const bridgeLines = (
    await Promise.all(
      sources.bridges.map(async (b) => {
        const coordinates = await entryGeometry(userId, b.kind, b.entryId);
        return coordinates ? [{ ...b, coordinates }] : [];
      })
    )
  ).flat();
  const judged = [
    ...sources.bridges.map((b) => [b.fromMs, b.untilMs] as const),
    ...sources.breaks.map(([f, u]) => [f, u] as const),
  ];
  return { sources, estimated: estimatedGaps(read, judged), bridgeLines };
}
