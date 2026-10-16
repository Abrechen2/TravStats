import { createHash } from "crypto";
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { zoneOf } from "../../../shared/time/zoneOf";
import { createDawarichClient, type DawarichClient } from "../dawarichClient";
import { buildUserDawarichConnection } from "../dawarichResolver";
import { DawarichError } from "../errors";
import { readStayWindow } from "./window";
import { detectStays, meters, RADIUS_METERS } from "./detect";

import {
  collectMarketFindings,
  isMarketFragment,
  marketFingerprint,
  type MarketFinding,
} from "../marketVisits/integration";
import { contains } from "../marketVisits/geometry";
import type { CatalogStore } from "../marketVisits/catalog";
import { Prisma } from "../../../prisma";
import { placesEnabledWhere, requirePlacesEnabled } from "./availability";
import { publicMarketCoverage } from "./publicCoverage";

const DAY = 86_400_000;
export async function ownConnection(userId: string) {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { dawarichBaseUrl: true, dawarichApiKey: true },
  });
  const connection =
    settings && buildUserDawarichConnection(settings.dawarichBaseUrl, settings.dawarichApiKey);
  if (!connection)
    throw new AppError("Own Dawarich connection required", 409, "DAWARICH_OWN_CONNECTION_REQUIRED");
  return connection;
}

/** A database lease also excludes another server process, not just another click. */
export async function reserveScan(userId: string, now = new Date()): Promise<void> {
  await requirePlacesEnabled(userId);
  const acquired = await prisma.dawarichStayScan.updateMany({
    where: {
      userId,
      enabled: true,
      ...placesEnabledWhere,
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
  } = {}
) {
  const now = options.now ?? new Date();
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
    await requirePlacesEnabled(userId);
    const client = options.client ?? createDawarichClient(await ownConnection(userId));
    const result = await readStayWindow(
      client,
      start,
      now,
      async () =>
        !!(await prisma.dawarichStayScan.findFirst({
          where: { userId, ...reservation!, enabled: true, ...placesEnabledWhere },
          select: { userId: true },
        }))
    );
    const points = result.points.filter(
      (p) => p.timestampMs >= start.getTime() && p.timestampMs <= now.getTime()
    );
    const stationary = detectStays(points, result.truncated);
    const places = await prisma.place.findMany({
      where: { userId },
      select: { id: true, name: true, lat: true, lon: true, externalRef: true, wikidataId: true },
    });
    const trips = await prisma.trip.findMany({
      where: { userId },
      select: { id: true, name: true, startDate: true, endDate: true },
    });
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
                ...placesEnabledWhere,
              },
              select: { userId: true },
            })),
        }
      );
    }
    const candidates: ((typeof stationary)[number] | MarketFinding)[] = [
      ...(markets?.findings ?? []),
      ...stationary.filter((c) => !markets || !isMarketFragment(c, markets, places)),
    ];
    let created = 0;
    for (const c of candidates) {
      // A late upstream response belongs to this reservation, never its successor.
      const current = await prisma.dawarichStayScan.findFirst({
        where: { userId, ...reservation, enabled: true, ...placesEnabledWhere },
        select: { userId: true },
      });
      if (!current) break;
      const market = "market" in c ? c : null;
      const old = await prisma.dawarichStay.findMany({
        where: {
          userId,
          status: { not: "superseded" },
          sourceStartAt: { lte: c.endAt },
          sourceEndAt: { gte: c.startAt },
        },
        select: { id: true, status: true, sourceLat: true, sourceLon: true, evidence: true },
      });
      const fragments =
        market && markets
          ? old.filter((row) => {
              const evidence = (row.evidence ?? {}) as { market?: unknown; pointIds?: number[] };
              if (evidence.market) return false;
              const area = markets.areas.find((a) => a.id === market.market.osmRef);
              if (
                area?.venueType &&
                area.venueType !== "market" &&
                !isMarketFragment(
                  { ...c, lat: row.sourceLat, lon: row.sourceLon },
                  markets!,
                  places
                )
              )
                return false;
              const shared =
                evidence.pointIds?.filter((id) => market.pointIds.includes(id)).length ?? 0;
              return shared >= 3 || !!(area && contains(area, row.sourceLon, row.sourceLat));
            })
          : [];
      if (
        old.some((row) => {
          if (!market)
            return meters({ lat: row.sourceLat, lon: row.sourceLon }, c) <= RADIUS_METERS * 2;
          const evidence = (row.evidence ?? {}) as {
            market?: { identity?: string; areaIds?: string[]; venueType?: string };
          };
          return (
            (evidence.market?.identity === market.market.identity &&
              (evidence.market?.venueType ?? "market") === (market.market.venueType ?? "market")) ||
            evidence.market?.areaIds?.some((id) => market.market.areaIds.includes(id)) ||
            (row.status === "rejected" && fragments.some((f) => f.id === row.id))
          );
        })
      )
        continue; // includes rejection/acceptance memory; pending fragments are superseded below
      const supersededFindingIds = fragments.filter((r) => r.status === "pending").map((r) => r.id);
      const zone = zoneOf(c);
      if (!zone) throw new AppError("Location timezone unavailable", 422, "TZ_UNRESOLVED");
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(c.startAt);
      const endDay = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(c.endAt);
      const overlappingTrips = trips.filter(
        (t) =>
          t.startDate &&
          t.endDate &&
          t.startDate.toISOString().slice(0, 10) <= endDay &&
          t.endDate.toISOString().slice(0, 10) >= day
      );
      const matchingTrips = overlappingTrips.filter(
        (t) =>
          t.startDate!.toISOString().slice(0, 10) <= day &&
          t.endDate!.toISOString().slice(0, 10) >= endDay
      );
      const trip =
        overlappingTrips.length === 1 && matchingTrips.length === 1 ? matchingTrips[0] : undefined;
      const nearby = places
        .map((p) => ({ ...p, distance: meters(p, c) }))
        .filter((p) => p.distance <= 100)
        .sort((a, b) => a.distance - b.distance);
      // Several nearby POIs can be different venues in the same building.
      const place = market
        ? market.placeId
          ? places.find((p) => p.id === market.placeId)
          : undefined
        : nearby.length === 1
          ? nearby[0]
          : undefined;
      const matchingVisit = place
        ? await prisma.placeVisit.findFirst({
            where: {
              userId,
              placeId: place.id,
              OR: [
                { visitedAtUtc: { gte: c.startAt, lte: c.endAt } },
                {
                  visitedPrecision: "day",
                  visitedAt: {
                    gte: new Date(day + "T00:00:00Z"),
                    lt: new Date(Date.parse(day + "T00:00:00Z") + DAY),
                  },
                },
              ],
            },
            select: { id: true },
          })
        : null;
      const fingerprint = market
        ? marketFingerprint(market)
        : createHash("sha256")
            .update(
              JSON.stringify([
                c.pointIds[0],
                c.pointIds.at(-1),
                c.startAt.toISOString(),
                c.endAt.toISOString(),
                c.lat,
                c.lon,
              ])
            )
            .digest("hex");
      const inserted = await prisma.$transaction(async (tx) => {
        // Lock the scan row with the consent/reservation predicate. Revocation
        // or takeover cannot slip between this check and the finding insert.
        const owned = await tx.dawarichStayScan.updateMany({
          where: { userId, ...reservation!, enabled: true, ...placesEnabledWhere },
          data: { result: "running" },
        });
        if (!owned.count) return { count: 0 };
        // Claim pending fragments before inserting the parent. A concurrent review
        // either resolves first (and prevents replacement) or receives a conflict.
        if (supersededFindingIds.length) {
          const superseded = await tx.dawarichStay.updateMany({
            where: { userId, id: { in: supersededFindingIds }, status: "pending" },
            data: { status: "superseded", resolvedAt: new Date() },
          });
          if (superseded.count !== supersededFindingIds.length)
            throw new AppError("Finding changed during scan", 409, "DAWARICH_ALREADY_RESOLVED");
        }
        return tx.dawarichStay.createMany({
          skipDuplicates: true,
          data: [
            {
              userId,
              fingerprint,
              sourceStartAt: c.startAt,
              sourceEndAt: c.endAt,
              sourceLat: c.lat,
              sourceLon: c.lon,
              startAt: c.startAt,
              endAt: c.endAt,
              lat: c.lat,
              lon: c.lon,
              zone,
              pointCount: c.pointCount,
              evidence: {
                source: "dawarich",
                ...(market
                  ? {
                      kind:
                        market.market.venueType && market.market.venueType !== "market"
                          ? "venue"
                          : "market",
                      market: market.market,
                      supersededFindingIds,
                    }
                  : {}),
                matchingVisitId: matchingVisit?.id ?? null,
                zone,
                pointIds: c.pointIds,
                maxGapMinutes: c.maxGapMinutes,
                uncertainties: [
                  ...c.uncertainties,
                  ...(overlappingTrips.length > 1 ? ["tripAmbiguous"] : []),
                  ...(overlappingTrips.length && !matchingTrips.length ? ["tripIncomplete"] : []),
                  ...(!market && nearby.length > 1 ? ["placeAmbiguous"] : []),
                ],
              },
              placeId: place?.id,
              name: market?.name ?? place?.name,
              tripId: market ? market.tripId : (trip?.id ?? null),
            },
          ],
        });
      });
      created += inserted.count;
      if (market && markets) markets.coverage.createdCount += inserted.count;
    }
    const newest = points.reduce((max, p) => Math.max(max, p.timestampMs), -Infinity);
    const dataThrough = Number.isFinite(newest) ? new Date(newest) : null;
    await prisma.dawarichStayScan.updateMany({
      where: { userId, ...reservation, enabled: true, ...placesEnabledWhere },
      data: {
        finishedAt: new Date(),
        leaseUntil: null,
        result:
          result.truncated || (markets && markets.coverage.status !== "complete")
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
      },
    });
    return {
      created,
      points: points.length,
      truncated: result.truncated,
      ...(markets ? { markets: publicMarketCoverage(markets.coverage) } : {}),
    };
  } catch (error) {
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
