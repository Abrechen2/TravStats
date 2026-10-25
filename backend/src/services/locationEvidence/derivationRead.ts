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
 *     device's last good fix as context (`derivationCursor.ts`). When
 *     deferring would hand on nothing, the read looks ahead past `maxPoints`
 *     until the open run resolves — an unresolved run is never handed on. A
 *     split read masks like an unsplit one.
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
import { anomalyMask, isBadFix, stableCut, type FlightWindow, type StableCut } from "./anomaly";
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

/** Past `maxPoints`, at most this many points are read looking for an open run's end. */
export const LOOKAHEAD_MAX = 10_000;
/** The lookahead's page: every page is one more judgement of the buffer, so not tiny ones. */
export const LOOKAHEAD_PAGE = 1_000;

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
  /**
   * The lookahead ran out with a run still open, so the read cut at its end
   * and handed that run on unresolved: the next read may judge the boundary
   * differently from an unsplit read. Only ever true with `truncated`.
   */
  unresolvedRun: boolean;
};

export type DerivationReadOptions = {
  isAllowed?: () => Promise<boolean>;
  maxPoints?: number;
  /** Continue a truncated read where it stopped. */
  cursor?: string;
  /** Points per page; the provider's cap unless a test needs small pages. */
  pageSize?: number;
  /** `LOOKAHEAD_MAX` unless a test needs a small one. */
  lookaheadMax?: number;
};

/** The recorder windows of the account's flights that touch `window`, `[from, to]` inclusive. */
async function flightWindowsIn(userId: string, window: ReadWindow): Promise<FlightWindow[]> {
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
  const lookaheadMax = opts.lookaheadMax ?? LOOKAHEAD_MAX;
  const generation = await prisma.$transaction((tx) => historyGeneration(tx, userId));

  const start = parseDerivationCursor(opts.cursor);
  // In the air first: the mask must know which steps are an aircraft's.
  const flightWindows = await flightWindowsIn(userId, window);
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
        unresolvedRun: false,
      };
    }
    first = false;
    const handedOn = raw.length - contextCount;
    // Up to `maxPoints` handed on (the previous read's context does not
    // count); past it only to look ahead for the end of an open run, and
    // never past `lookaheadMax`.
    const cap =
      handedOn < maxPoints
        ? Math.min(pageSize, maxPoints - handedOn)
        : Math.min(pageSize, LOOKAHEAD_PAGE, maxPoints + lookaheadMax - handedOn);
    const page = await travtrackProvider(userId, cap).readPoints(window, cursor);
    for (const p of page.points) {
      raw.push(p);
      if (isContext(p, start.emitAfter)) contextCount += 1;
    }
    cursor = page.next ?? undefined;
    const read: RawRead = { raw, contextCount, resumeAfter: start.resumeAfter };
    if (!cursor) {
      return finish(userId, judge(read, flightWindows, "complete"), flightWindows, generation);
    }
    const handedOnNow = raw.length - contextCount;
    if (handedOnNow >= maxPoints) {
      const judgement = judge(read, flightWindows, "stable");
      // A cut that would hand on nothing sits in front of a run still open:
      // read on until it resolves — up to the lookahead's cap, then cut at
      // the end and say the run went on unresolved.
      if (judgement.cut.until > judgement.fresh) {
        return finish(userId, judgement, flightWindows, generation);
      }
      if (handedOnNow >= maxPoints + lookaheadMax) {
        return finish(userId, judge(read, flightWindows, "atEnd"), flightWindows, generation);
      }
    }
  }
}

type RawRead = {
  raw: readonly LocationObservation[];
  /** The leading points that are the previous read's context. */
  contextCount: number;
  /** Where this read started. */
  resumeAfter: string | undefined;
};

type Judgement = {
  read: RawRead;
  /** Indices into `read.raw` of what is judged: the context fixes, then every fresh point. */
  judged: number[];
  /** Index into `judged` of the first fresh point. */
  fresh: number;
  masked: boolean[];
  cut: StableCut;
  mode: CutMode;
};

/** `complete`: the window's end. `stable`: final verdicts. `atEnd`: the lookahead is spent. */
type CutMode = "complete" | "stable" | "atEnd";

/** Of the previous read's context, each device's last good fix — all the next judgement needs. */
function contextFixes(raw: readonly LocationObservation[], count: number): number[] {
  const last = new Map<string | null, number>();
  for (let i = 0; i < count; i += 1) {
    if (!isBadFix(raw[i])) last.set(raw[i].deviceId, i);
  }
  return [...last.values()].sort((a, b) => a - b);
}

function judge(read: RawRead, flightWindows: FlightWindow[], mode: CutMode): Judgement {
  const { raw, contextCount } = read;
  const judged = [...contextFixes(raw, contextCount), ...raw.map((_, i) => i).slice(contextCount)];
  const fresh = judged.length - (raw.length - contextCount);
  const observations = judged.map((i) => raw[i]);
  const masked = anomalyMask(observations, { flightWindows });
  const cut =
    mode === "complete"
      ? { until: observations.length, contextFrom: observations.length }
      : stableCut(observations, { flightWindows }, { atEnd: mode === "atEnd" });
  return { read, judged, fresh, masked, cut, mode };
}

function finish(
  userId: string,
  { read, judged, fresh, masked, cut, mode }: Judgement,
  flightWindows: FlightWindow[],
  generation: bigint
): DerivationRead {
  const { raw } = read;
  const truncated = mode !== "complete";
  const points: DerivationPoint[] = [];
  for (let j = fresh; j < cut.until; j += 1) {
    if (masked[j]) continue;
    const o = raw[judged[j]];
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
    unresolvedRun: mode === "atEnd",
  };
}
