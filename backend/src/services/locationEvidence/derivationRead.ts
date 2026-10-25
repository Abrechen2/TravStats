/**
 * The one read of TravTrack that everything derived from it starts with
 * (TravTrack plan E2): stays, market visits, country days, journeys. TravTrack
 * only — the other provider keeps its own reads, byte for byte.
 *
 *   - The history generation is captured BEFORE the first page, so a removal
 *     that lands while the read runs is seen when the finding is published
 *     (E5's fence), never folded silently into it.
 *   - Every page is read to the end. A read that stops at `maxPoints` says
 *     `truncated` and hands back the cursor it stopped at; a window is never
 *     shortened silently.
 *   - `isAllowed()` is asked between pages — the scan's lease and consent.
 *     Answered false, the read is cancelled and hands on nothing.
 *   - Fixes inside one of the account's flight windows carry `inFlight:
 *     true`, and that is settled first: a step in the air is no jump.
 *     Anomalies are masked (`anomaly.ts`), never deleted.
 *   - A truncated read stops where its verdicts are final (`stableCut`): a
 *     run the next read could still close is deferred to it, with each
 *     device's last good fix as context (`derivationCursor.ts`). A split read
 *     masks like an unsplit one.
 *
 * Privacy: stored TravTrack points already exclude privacy zones and deleted
 * ranges (ingest drops them, zone creation deletes them), so this read adds no
 * second filter. Whether TravTrack is on is the caller's question — a
 * derivation asks it before it reads and again before it publishes.
 */
import { prisma } from "../../db";
import { flightRecorderWindows, FLIGHT_WINDOW_SELECT } from "../tripRecording/bounds";
import { TRAVTRACK_PAGE_CAP, travtrackProvider } from "../locationProvider/travtrackProvider";
import type { Coverage, LocationObservation, ReadWindow } from "../locationProvider/types";
import { anomalyMask, isBadFix, stableCut } from "./anomaly";
import {
  formatDerivationCursor,
  isContext,
  parseDerivationCursor,
  positionOf,
} from "./derivationCursor";
import { historyGeneration } from "./generation";
import { observationKey, pointDigest } from "./key";

/** The stay window's cap: more than this in one derivation read is truncated, and said to be. */
export const DERIVATION_MAX_POINTS = 250_000;

export type DerivationPoint = LocationObservation & {
  /** The provider-neutral observation key (`observationKey`). Server-side only. */
  key: string;
  /** This account's digest of `key`. Sensitive: never in a response, an export or a log. */
  digest: string;
  /** Inside the recorder window of one of the account's flights. */
  inFlight: boolean;
};

export type DerivationRead = {
  points: DerivationPoint[];
  coverage: Coverage;
  /** Where the next read continues (`derivationCursor.ts`); null when the window was read to its end. */
  next: string | null;
  /** The account's history generation before the first page was read. */
  generation: bigint;
  cancelled: boolean;
};

export type DerivationReadOptions = {
  isAllowed?: () => Promise<boolean>;
  maxPoints?: number;
  /** Continue a truncated read where it stopped. */
  cursor?: string;
  /** Points per page; the provider's cap unless a test needs small pages. */
  pageSize?: number;
};

/** The recorder windows of the account's flights that touch `window`, `[from, to]` inclusive. */
async function flightWindowsIn(
  userId: string,
  window: ReadWindow
): Promise<Array<[number, number]>> {
  const flights = await prisma.flight.findMany({
    where: { userId, status: { not: "cancelled" } },
    select: FLIGHT_WINDOW_SELECT,
  });
  const windows = await flightRecorderWindows(flights);
  return windows.filter(([from, to]) => from < window.untilMs && to >= window.fromMs);
}

export async function readTravTrackDerivation(
  userId: string,
  window: ReadWindow,
  opts: DerivationReadOptions = {}
): Promise<DerivationRead> {
  const maxPoints = opts.maxPoints ?? DERIVATION_MAX_POINTS;
  const pageSize = opts.pageSize ?? TRAVTRACK_PAGE_CAP;
  const generation = await prisma.$transaction((tx) => historyGeneration(tx, userId));

  const start = parseDerivationCursor(opts.cursor);
  const raw: LocationObservation[] = [];
  let contextCount = 0;
  let cursor = start.resumeAfter;
  let first = true;
  for (;;) {
    if (!first && opts.isAllowed && !(await opts.isAllowed())) {
      // Nothing is handed on, so the next attempt starts where this one did.
      return {
        points: [],
        coverage: "truncated",
        next: opts.cursor ?? null,
        generation,
        cancelled: true,
      };
    }
    first = false;
    // Never past `maxPoints` handed on; the previous read's context does not count.
    const cap = Math.min(pageSize, maxPoints - (raw.length - contextCount));
    const page = await travtrackProvider(userId, cap).readPoints(window, cursor);
    for (const p of page.points) {
      raw.push(p);
      if (isContext(p, start.emitAfter)) contextCount += 1;
    }
    cursor = page.next ?? undefined;
    if (!cursor) break;
    if (raw.length - contextCount >= maxPoints) {
      return finish(
        userId,
        window,
        { raw, contextCount, resumeAfter: start.resumeAfter },
        true,
        generation
      );
    }
  }
  return finish(
    userId,
    window,
    { raw, contextCount, resumeAfter: start.resumeAfter },
    false,
    generation
  );
}

type RawRead = {
  raw: readonly LocationObservation[];
  /** The leading points that are the previous read's context. */
  contextCount: number;
  /** Where this read started. */
  resumeAfter: string | undefined;
};

/** Of the previous read's context, each device's last good fix — all the next judgement needs. */
function contextFixes(raw: readonly LocationObservation[], count: number): number[] {
  const last = new Map<string | null, number>();
  for (let i = 0; i < count; i += 1) {
    if (!isBadFix(raw[i])) last.set(raw[i].deviceId, i);
  }
  return [...last.values()].sort((a, b) => a - b);
}

async function finish(
  userId: string,
  window: ReadWindow,
  read: RawRead,
  truncated: boolean,
  generation: bigint
): Promise<DerivationRead> {
  const { raw, contextCount } = read;
  // In the air first: the mask must know which steps are an aircraft's.
  const flightWindows = await flightWindowsIn(userId, window);
  const judged = [...contextFixes(raw, contextCount), ...raw.map((_, i) => i).slice(contextCount)];
  const fresh = judged.length - (raw.length - contextCount);
  const observations = judged.map((i) => raw[i]);
  const masked = anomalyMask(observations, { flightWindows });
  const cut = truncated
    ? stableCut(observations, fresh, { flightWindows })
    : { until: observations.length, contextFrom: observations.length };

  const points: DerivationPoint[] = [];
  for (let j = fresh; j < cut.until; j += 1) {
    if (masked[j]) continue;
    const o = observations[j];
    const key = observationKey(o);
    points.push({
      ...o,
      key,
      digest: pointDigest(userId, key),
      inFlight: flightWindows.some(([from, to]) => o.atMs >= from && o.atMs <= to),
    });
  }

  let next: string | null = null;
  if (truncated) {
    const rawIndex = (j: number) => (j < judged.length ? judged[j] : raw.length);
    const resumeAt = rawIndex(cut.contextFrom);
    const resumeAfter = resumeAt > 0 ? positionOf(raw[resumeAt - 1]) : read.resumeAfter;
    next = formatDerivationCursor(resumeAfter, positionOf(raw[rawIndex(cut.until) - 1]));
  }
  return {
    points,
    coverage: truncated ? "truncated" : "complete",
    next,
    generation,
    cancelled: false,
  };
}
