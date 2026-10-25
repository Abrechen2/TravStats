import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import type { DawarichClient } from "../dawarichClient";
import { DawarichError } from "../errors";
import { readStayWindow } from "./window";
import { detectStays, type StayPoint } from "./detect";

import {
  collectMarketFindings,
  isMarketFragment,
  type MarketFinding,
} from "../marketVisits/integration";
import type { CatalogStore } from "../marketVisits/catalog";
import { Prisma } from "../../../prisma";
import {
  requirePlacesEnabled,
  requireStaySuggestionsEnabled,
  stayScanAllowed,
} from "./availability";
import { publicMarketCoverage } from "./publicCoverage";
import { loadSuppression } from "./suppression";
import { loadCoverage, resolveCoveredStays } from "./coverage";
import { TRIP_SPAN_SELECT } from "../../places/visitTrip";
import { readTravTrackDerivation } from "../../locationEvidence/derivationRead";
import { toDetectorInput } from "../../locationEvidence/toDetectorInput";
import type { Coverage } from "../../locationProvider/types";
import { travTrackInstanceOn } from "../../travtrack/availability";
import { privacyCircleSet } from "../../travtrack/privacyCircles";
import { ownConnection, staySource, staySourceKind } from "./scanSource";
import { scanCandidates, type ScanContext } from "./scanCandidates";
import logger from "../../../utils/logger";

export { ownConnection };

const DAY = 86_400_000;

/**
 * A database lease also excludes another server process, not just another
 * click. The scan's source is decided first (`scanSource.ts`): a refusal —
 * TravTrack switched off, a scheduled account whose provider reads nothing —
 * reserves nothing.
 */
export async function reserveScan(
  userId: string,
  now = new Date(),
  options: { scheduled?: boolean } = {}
): Promise<void> {
  await requireStaySuggestionsEnabled(userId);
  await requirePlacesEnabled(userId);
  const scheduled = options.scheduled === true;
  const source = await staySourceKind(userId, { scheduled });
  const acquired = await prisma.dawarichStayScan.updateMany({
    where: {
      userId,
      enabled: true,
      ...stayScanAllowed(scheduled, source.kind),
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: {
      startedAt: now,
      leaseUntil: new Date(now.getTime() + 60 * 60_000),
      result: "running",
      error: null,
    },
  });
  if (!acquired.count)
    throw new AppError("Scan disabled or already running", 409, "DAWARICH_SCAN_UNAVAILABLE");
}

/** The window's points from the scan's source, in the detectors' shape. */
async function readScanPoints(
  userId: string,
  source: Awaited<ReturnType<typeof staySource>>,
  start: Date,
  now: Date,
  isAllowed: () => Promise<boolean>
): Promise<{
  points: StayPoint[];
  truncated: boolean;
  travtrack?: { generation: bigint; readCoverage: Coverage };
}> {
  if (source.kind === "dawarich") {
    const result = await readStayWindow(source.client, start, now, isAllowed);
    const points = result.points.filter(
      (p) => p.timestampMs >= start.getTime() && p.timestampMs <= now.getTime()
    );
    return { points, truncated: result.truncated };
  }
  // TravTrack: one derivation read (E2) — anomalies masked, in-flight fixes
  // left out, nothing but stored points (zones and deleted spans never are).
  const read = await readTravTrackDerivation(
    userId,
    { fromMs: start.getTime(), untilMs: now.getTime() + 1 },
    { isAllowed }
  );
  return {
    points: read.points.filter((p) => !p.inFlight).map(toDetectorInput),
    truncated: read.coverage === "truncated",
    travtrack: { generation: read.generation, readCoverage: read.coverage },
  };
}

/** Only findings are written. Confirmation is the sole path to a PlaceVisit. */
export async function scanStays(
  userId: string,
  options: {
    now?: Date;
    client?: DawarichClient;
    lookbackDays?: number;
    marketStore?: CatalogStore;
    marketFetcher?: typeof fetch;
    marketEndpoint?: string;
    /** Run by the schedule: also stops once its source is no longer the provider. */
    scheduled?: boolean;
  } = {}
) {
  const now = options.now ?? new Date();
  const scheduled = options.scheduled === true;
  const days = options.lookbackDays ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new AppError("Invalid scan window", 400);
  const start = new Date(now.getTime() - days * DAY);
  let reservation: { startedAt: Date; leaseUntil: Date } | null = null;
  try {
    const state = await prisma.dawarichStayScan.findUnique({ where: { userId } });
    if (!state?.enabled) throw new AppError("Scan disabled", 409, "DAWARICH_SCAN_UNAVAILABLE");
    if (!state.startedAt || !state.leaseUntil)
      throw new AppError("Scan reservation required", 409, "DAWARICH_SCAN_UNAVAILABLE");
    reservation = { startedAt: state.startedAt, leaseUntil: state.leaseUntil };
    await requireStaySuggestionsEnabled(userId);
    await requirePlacesEnabled(userId);
    const source = await staySource(userId, { scheduled, client: options.client });
    const stayScanAllowedWhere = stayScanAllowed(scheduled, source.kind);
    // TravTrack switched off stops a TravTrack scan at its next check; a
    // Dawarich scan does not look at the switch.
    const stillAllowed = async () => source.kind !== "travtrack" || (await travTrackInstanceOn());
    const result = await readScanPoints(
      userId,
      source,
      start,
      now,
      async () =>
        !!(await prisma.dawarichStayScan.findFirst({
          where: { userId, ...reservation!, enabled: true, ...stayScanAllowedWhere },
          select: { userId: true },
        })) && (await stillAllowed())
    );
    const points = result.points;
    const stationary = detectStays(points, result.truncated);
    const places = await prisma.place.findMany({
      where: { userId },
      select: { id: true, name: true, lat: true, lon: true, externalRef: true, wikidataId: true },
    });
    const trips = await prisma.trip.findMany({ where: { userId }, select: TRIP_SPAN_SELECT });
    const suppression = await loadSuppression(userId);
    const coverage = await loadCoverage(userId, start, now);
    let markets: Awaited<ReturnType<typeof collectMarketFindings>> | null = null;
    if (state.marketEnabled || state.venueEnabled) {
      const visits = await prisma.placeVisit.findMany({
        where: { userId },
        select: {
          id: true,
          placeId: true,
          tripId: true,
          visitedAt: true,
          visitedAtUtc: true,
          visitedPrecision: true,
        },
      });
      markets = await collectMarketFindings(
        points,
        {
          places,
          visits: visits.map((v) => ({
            ...v,
            visitedAt: v.visitedAt?.toISOString() ?? null,
            visitedAtUtc: v.visitedAtUtc?.toISOString() ?? null,
          })),
          trips: trips.map((t) => ({
            ...t,
            startDate: t.startDate?.toISOString() ?? null,
            endDate: t.endDate?.toISOString() ?? null,
            startDay: t.startDay?.toISOString() ?? null,
            endDay: t.endDay?.toISOString() ?? null,
          })),
        },
        {
          includeVenues: state.venueEnabled,
          includeMarkets: state.marketEnabled,
          store: options.marketStore,
          fetcher: options.marketFetcher,
          endpoint: options.marketEndpoint,
          isAllowed: async () =>
            !!(await prisma.dawarichStayScan.findFirst({
              where: {
                userId,
                ...reservation!,
                enabled: true,
                ...(state.marketEnabled ? { marketEnabled: true } : {}),
                ...(state.venueEnabled ? { venueEnabled: true } : {}),
                ...stayScanAllowedWhere,
              },
              select: { userId: true },
            })) && (await stillAllowed()),
        }
      );
    }
    const candidates: ((typeof stationary)[number] | MarketFinding)[] = [
      ...(markets?.findings ?? []),
      ...stationary.filter((c) => !markets || !isMarketFragment(c, markets, places)),
    ];
    const ctx: ScanContext = {
      userId,
      source: source.kind,
      rev: source.rev,
      allowedWhere: { ...reservation, enabled: true, ...stayScanAllowedWhere },
      stillAllowed,
      points,
      markets,
      places,
      trips,
      suppression,
      coverage,
      ...(result.travtrack
        ? { travtrack: { ...result.travtrack, circles: await privacyCircleSet(userId) } }
        : {}),
    };
    const counts = await scanCandidates(ctx, candidates);
    const { created, extended, suppressed, skippedNoZone, covered } = counts;
    // Visits logged since an earlier scan made its finding (live, on the
    // phone) resolve those findings now, as `covered`, with what covered them.
    const resolvedCovered = await resolveCoveredStays(userId);
    const newest = points.reduce((max, p) => Math.max(max, p.timestampMs), -Infinity);
    const dataThrough = Number.isFinite(newest) ? new Date(newest) : null;
    await prisma.dawarichStayScan.updateMany({
      where: { userId, ...reservation, enabled: true, ...stayScanAllowedWhere },
      data: {
        finishedAt: new Date(),
        leaseUntil: null,
        // A TravTrack read whose history changed before it published (E5's
        // fence) is neither a success nor a failure: the next run reads afresh.
        result: counts.stale
          ? "stale"
          : result.truncated || (markets && markets.coverage.status !== "complete")
            ? "partial"
            : "succeeded",
        marketResult: markets
          ? (publicMarketCoverage(markets.coverage) as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        error: null,
        windowStart: start,
        windowEnd: now,
        dataThrough,
        pointCount: points.length,
        createdCount: created,
        provider: source.kind,
      },
    });
    const travtrackCounts = result.travtrack
      ? { skippedPrivate: counts.skippedPrivate, deferred: counts.deferred, stale: counts.stale }
      : {};
    if (
      suppressed ||
      skippedNoZone ||
      covered ||
      resolvedCovered ||
      counts.skippedPrivate ||
      counts.deferred
    )
      logger.info(
        {
          operation: "dawarich_stay_scan_filtered",
          userId,
          suppressed,
          skippedNoZone,
          covered,
          resolvedCovered,
          // Counts only: a private candidate is never logged with its position.
          ...travtrackCounts,
        },
        "Dawarich stay candidates left out of this scan"
      );
    return {
      created,
      extended,
      suppressed,
      skippedNoZone,
      covered,
      resolvedCovered,
      points: points.length,
      truncated: result.truncated,
      ...(markets ? { markets: publicMarketCoverage(markets.coverage) } : {}),
      ...travtrackCounts,
    };
  } catch (error) {
    if (!(error instanceof DawarichError) && !(error instanceof AppError))
      logger.error(
        { operation: "dawarich_stay_scan_error", userId, err: error },
        "Dawarich stay scan failed unexpectedly"
      );
    const code =
      error instanceof DawarichError
        ? error.kind
        : error instanceof AppError
          ? (error.code ?? "FAILED")
          : "FAILED";
    if (reservation)
      await prisma.dawarichStayScan.updateMany({
        where: { userId, ...reservation },
        data: { finishedAt: new Date(), leaseUntil: null, result: "failed", error: code },
      });
    throw new AppError("Dawarich stay scan failed", 502, "DAWARICH_STAY_SCAN_FAILED");
  }
}
