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
 *   - Anomalies are masked (`anomaly.ts`), never deleted; fixes inside one of
 *     the account's flight windows carry `inFlight: true`.
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
import { anomalyMask } from "./anomaly";
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
  /** Where a truncated read stopped; null when the window was read to its end. */
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

  const raw: LocationObservation[] = [];
  let cursor = opts.cursor;
  let first = true;
  for (;;) {
    if (!first && opts.isAllowed && !(await opts.isAllowed())) {
      return {
        points: [],
        coverage: "truncated",
        next: cursor ?? null,
        generation,
        cancelled: true,
      };
    }
    first = false;
    // Never past `maxPoints`: the cursor then names exactly the first unread point.
    const cap = Math.min(pageSize, maxPoints - raw.length);
    const page = await travtrackProvider(userId, cap).readPoints(window, cursor);
    raw.push(...page.points);
    cursor = page.next ?? undefined;
    if (!cursor) break;
    if (raw.length >= maxPoints) {
      return finish(userId, window, raw, "truncated", cursor, generation);
    }
  }
  return finish(userId, window, raw, "complete", null, generation);
}

async function finish(
  userId: string,
  window: ReadWindow,
  raw: readonly LocationObservation[],
  coverage: Coverage,
  next: string | null,
  generation: bigint
): Promise<DerivationRead> {
  const flights = await flightWindowsIn(userId, window);
  const masked = anomalyMask(raw);
  const points = raw
    .filter((_, i) => !masked[i])
    .map((o): DerivationPoint => {
      const key = observationKey(o);
      return {
        ...o,
        key,
        digest: pointDigest(userId, key),
        inFlight: flights.some(([from, to]) => o.atMs >= from && o.atMs <= to),
      };
    });
  return { points, coverage, next, generation, cancelled: false };
}
