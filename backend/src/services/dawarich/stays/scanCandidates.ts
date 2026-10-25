/**
 * The per-candidate half of a stay scan (split from `scan.ts`, TravTrack plan
 * E3): each stationary cluster or venue visit is matched against what the
 * account already knows and decided, and written as a finding — or not.
 *
 * The Dawarich branch is the code path it always was; its rows gain only the
 * provider columns E1 added (`provider`, `provider_rev`, `algorithm_version`
 * = 0, `evidence_key`). A TravTrack scan writes the same kind of row with its
 * own evidence (digests, never ids; an explanation; the read's coverage),
 * skips a candidate inside a privacy circle, publishes at most
 * `TRAVTRACK_FINDINGS_PER_RUN` new findings, and publishes nothing once the
 * account's history generation moved since its read (a removal landed).
 */
import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { zoneOf } from "../../../shared/time/zoneOf";
import type { Coverage } from "../../locationProvider/types";
import { historyGeneration } from "../../locationEvidence/generation";
import { STAY_ALGORITHM } from "../../locationEvidence/types";
import type { CircleSet } from "../../travtrack/privacyCircles";
import { inPrivacyZone } from "../../travtrack/classify";
import { takeTravTrackLock } from "../../travtrack/lock";
import { travTrackInstanceOnIn } from "../../travtrack/availability";
import { meters, RADIUS_METERS, type StayCandidate, type StayPoint } from "./detect";
import {
  collectMarketFindings,
  isMarketFragment,
  type MarketFinding,
} from "../marketVisits/integration";
import { contains } from "../marketVisits/geometry";
import { tripForStay } from "./tripMatch";
import { suppressionReason, type loadSuppression } from "./suppression";
import { coverageFor, type loadCoverage } from "./coverage";
import type { StaySourceKind } from "./availability";
import {
  evidenceKeyOf,
  findingEvidence,
  findingFingerprint,
  findingKind,
  storedPointIds,
} from "./scanFinding";
import logger from "../../../utils/logger";

const DAY = 86_400_000;
const travTrackDisabled = () =>
  new AppError("TravTrack is switched off on this server", 403, "TRAVTRACK_DISABLED");
/** Bounded prompting (review focus 19): new TravTrack findings one run may publish. */
export const TRAVTRACK_FINDINGS_PER_RUN = 20;

type Markets = Awaited<ReturnType<typeof collectMarketFindings>>;
type Place = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  externalRef: string | null;
  wikidataId: string | null;
};
type TripSpan = Parameters<typeof tripForStay>[0][number];

export type ScanContext = {
  userId: string;
  source: StaySourceKind;
  rev: number;
  /** The reservation-and-consent predicate; checked before every candidate and in its insert. */
  allowedWhere: object;
  /** A further check beside it (TravTrack: the instance is still on). */
  stillAllowed: () => Promise<boolean>;
  points: readonly StayPoint[];
  markets: Markets | null;
  places: Place[];
  trips: TripSpan[];
  suppression: Awaited<ReturnType<typeof loadSuppression>>;
  coverage: Awaited<ReturnType<typeof loadCoverage>>;
  /** TravTrack only. */
  travtrack?: { generation: bigint; circles: CircleSet; readCoverage: Coverage };
};

export type CandidateCounts = {
  created: number;
  extended: number;
  suppressed: number;
  skippedNoZone: number;
  covered: number;
  skippedPrivate: number;
  deferred: number;
  stale: boolean;
};

/**
 * The pending plain-stop finding this candidate continues, or null. A stay
 * still going on when a scan ran ends at that scan's last point; the next scan
 * sees the same stop with a later end (or an earlier start) and must grow the
 * finding rather than leave it frozen. Only when the candidate holds the whole
 * old interval and is longer, the row is the one known match, and both come
 * from the same source — a Dawarich finding is never rewritten with TravTrack
 * evidence, nor the other way round.
 */
function grownPendingRow<
  T extends {
    id: string;
    status: string;
    provider: string;
    sourceStartAt: Date;
    sourceEndAt: Date;
    evidence: unknown;
  },
>(known: readonly T[], c: { startAt: Date; endAt: Date }, source: StaySourceKind): T | null {
  if (known.length !== 1) return null;
  const row = known[0];
  if (row.status !== "pending" || (row.evidence as { market?: unknown } | null)?.market)
    return null;
  if (row.provider !== source) return null;
  const holds = c.startAt <= row.sourceStartAt && c.endAt >= row.sourceEndAt;
  const longer = c.startAt < row.sourceStartAt || c.endAt > row.sourceEndAt;
  return holds && longer ? row : null;
}

export async function scanCandidates(
  ctx: ScanContext,
  candidates: readonly (StayCandidate | MarketFinding)[]
): Promise<CandidateCounts> {
  const { userId, source, markets, places, trips, suppression, coverage } = ctx;
  const counts: CandidateCounts = {
    created: 0,
    extended: 0,
    suppressed: 0,
    skippedNoZone: 0,
    covered: 0,
    skippedPrivate: 0,
    deferred: 0,
    stale: false,
  };
  const byId = new Map(ctx.points.map((p) => [p.id, p]));
  for (const c of candidates) {
    // A late upstream response belongs to this reservation, never its successor.
    const current = await prisma.dawarichStayScan.findFirst({
      where: { userId, ...ctx.allowedWhere },
      select: { userId: true },
    });
    if (!current) break;
    // TravTrack switched off stops the run as a failure the scan row names.
    if (!(await ctx.stillAllowed())) throw travTrackDisabled();
    if (ctx.travtrack && inPrivacyZone(c, ctx.travtrack.circles(c.startAt.getTime()))) {
      // Counted only: neither the answer nor a log names where it was.
      counts.skippedPrivate++;
      continue;
    }
    const market = "market" in c ? c : null;
    const old = await prisma.dawarichStay.findMany({
      where: {
        userId,
        status: { not: "superseded" },
        sourceStartAt: { lte: c.endAt },
        sourceEndAt: { gte: c.startAt },
      },
      select: {
        id: true,
        status: true,
        provider: true,
        sourceLat: true,
        sourceLon: true,
        sourceStartAt: true,
        sourceEndAt: true,
        evidence: true,
      },
    });
    const fragments =
      market && markets
        ? old.filter((row) => {
            const evidence = (row.evidence ?? {}) as { market?: unknown };
            if (evidence.market) return false;
            const area = markets.areas.find((a) => a.id === market.market.osmRef);
            if (
              area?.venueType &&
              area.venueType !== "market" &&
              !isMarketFragment({ ...c, lat: row.sourceLat, lon: row.sourceLon }, markets, places)
            )
              return false;
            // Ids are compared within one source only: numbers with numbers,
            // digests with digests. The area-containment half works across.
            const shared =
              storedPointIds(row, source)?.filter((id) => market.pointIds.includes(id)).length ?? 0;
            return shared >= 3 || !!(area && contains(area, row.sourceLon, row.sourceLat));
          })
        : [];
    const known = old.filter((row) => {
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
    });
    // Known: rejection/acceptance memory, or the same stop already pending.
    // The one exception is a pending stop that has grown since — a stay still
    // going on at the last scan froze at that scan's last point.
    const growing = !market && known.length ? grownPendingRow(known, c, source) : null;
    if (known.length && !growing) continue;
    const supersededFindingIds = fragments.filter((r) => r.status === "pending").map((r) => r.id);
    const zone = zoneOf(c);
    if (!zone) {
      // One position without a zone used to fail the whole scan, every scan,
      // until the window moved past it. It is that candidate's problem alone.
      counts.skippedNoZone++;
      logger.warn(
        source === "dawarich"
          ? { operation: "dawarich_stay_zone_unresolved", userId, lat: c.lat, lon: c.lon }
          : // TravTrack positions are not logged.
            { operation: "dawarich_stay_zone_unresolved", userId, source },
        "Dawarich stay candidate skipped: no timezone at its position"
      );
      continue;
    }
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
    if (!market && !growing) {
      const why = suppressionReason(c, day, suppression);
      if (why) {
        counts.suppressed++;
        continue;
      }
    }
    // Already recorded — a visit or a hotel stay there and then. Not a
    // question, and accepting it would record the stop a second time.
    // Plain stops only: a market or venue finding is the whole site, and a
    // confirmed shop inside it is not that visit — `collectMarketFindings`
    // answers "already recorded" for those by the venue's own identity.
    const evidenceKey = evidenceKeyOf(c, byId);
    if (!market && !growing && coverageFor({ ...c, zone, evidenceKey }, coverage)) {
      counts.covered++;
      continue;
    }
    if (ctx.travtrack && !growing && counts.created >= TRAVTRACK_FINDINGS_PER_RUN) {
      // Bounded prompting: the rest wait for the next run.
      counts.deferred++;
      continue;
    }
    const tripMatch = tripForStay(trips, day, endDay);
    const overlappingTrips = tripMatch.overlapping;
    const matchingTrips = tripMatch.containing;
    const trip = tripMatch.trip ?? undefined;
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
    const fingerprint = findingFingerprint(source, c, market, evidenceKey);
    const kind = market ? findingKind(market) : null;
    const uncertainties = [
      ...c.uncertainties,
      ...(overlappingTrips.length > 1 ? ["tripAmbiguous"] : []),
      ...(overlappingTrips.length && !matchingTrips.length ? ["tripIncomplete"] : []),
      ...(!market && nearby.length > 1 ? ["placeAmbiguous"] : []),
    ];
    const evidence = findingEvidence(c, {
      market,
      kind,
      supersededFindingIds,
      matchingVisitId: matchingVisit?.id ?? null,
      zone,
      uncertainties,
      travtrack: ctx.travtrack ?? null,
    });
    const row = {
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
      evidence,
      placeId: place?.id,
      name: market?.name ?? place?.name,
      tripId: market ? market.tripId : (trip?.id ?? null),
      provider: source,
      providerRev: ctx.rev,
      // The legacy Dawarich path is not re-versioned.
      algorithmVersion: ctx.travtrack ? STAY_ALGORITHM : 0,
      evidenceKey,
    };
    const inserted = await prisma.$transaction(async (tx) => {
      // TravTrack: the lock first, so every check below is made once nothing
      // can change the history under this finding any more, and a consent
      // withdrawal never waits for a scan stuck behind the lock.
      if (ctx.travtrack) await takeTravTrackLock(tx, userId);
      // Lock the scan row with the consent/reservation predicate. Revocation
      // or takeover cannot slip between this check and the finding insert.
      const owned = await tx.dawarichStayScan.updateMany({
        where: { userId, ...ctx.allowedWhere },
        data: { result: "running" },
      });
      if (!owned.count) return { count: 0, extended: 0, stale: false };
      if (ctx.travtrack) {
        // Switched off while this candidate was matched or waited: nothing.
        if (!(await travTrackInstanceOnIn(tx))) throw travTrackDisabled();
        // The publication fence (E5): a removal raises the generation under
        // this lock, in its own transaction. Read before it, publish nothing.
        if ((await historyGeneration(tx, userId)) !== ctx.travtrack.generation)
          return { count: 0, extended: 0, stale: true };
      }
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
      if (growing) {
        // Rewritten as a whole: a pending row holds nothing the user decided.
        // The fingerprint stays the one the finding was made with.
        const grown = await tx.dawarichStay.updateMany({
          where: { id: growing.id, userId, status: "pending" },
          data: row,
        });
        return { count: 0, extended: grown.count, stale: false };
      }
      const made = await tx.dawarichStay.createMany({
        skipDuplicates: true,
        data: [{ userId, fingerprint, ...row }],
      });
      return { count: made.count, extended: 0, stale: false };
    });
    if (inserted.stale) {
      counts.stale = true;
      break;
    }
    counts.created += inserted.count;
    counts.extended += inserted.extended;
    if (market && markets) markets.coverage.createdCount += inserted.count;
  }
  return counts;
}
