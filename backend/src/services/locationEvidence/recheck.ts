/**
 * Does a TravTrack finding's evidence still hold? (TravTrack plan E4, step 2.)
 * Asked on accept, against the history as it is NOW, by the kind's own
 * detector rules over the finding's window ± 30 minutes:
 *
 *   - stay: `detectStays` (its accuracy, speed, gap, point and duration rules)
 *     still finds a stop within `2 × RADIUS_METERS` of the finding's position
 *     that covers at least 80 % of its window;
 *   - market / venue: `detectMarketVisits` against the finding's own areas,
 *     read from the public catalogue cache only (no map request is made on
 *     accept), still finds a visit to one of them — which also means the
 *     venue's minimum duration. When the cache no longer holds the area, the
 *     finding's own points must still be there in the venue's minimum number
 *     and duration.
 *
 * The history generation the read captured comes back with the outcome, so
 * the publication can tell a removal that landed after this read (E5's fence).
 * Entries made by accepting are not points and are never read here: an
 * acceptance cannot support itself.
 */
import type { CatalogStore } from "../dawarich/marketVisits/catalog";
import { discoverMarketAreas } from "../dawarich/marketVisits/catalog";
import { marketCatalogStore } from "../dawarich/marketVisits/catalogStore";
import { detectMarketVisits, MARKET_RULES } from "../dawarich/marketVisits/detect";
import { venueMinimumMinutes, type VenueType } from "../dawarich/marketVisits/venueTypes";
import { detectStays, meters, RADIUS_METERS, type StayPoint } from "../dawarich/stays/detect";
import { readTravTrackDerivation } from "./derivationRead";
import { toDetectorInput } from "./toDetectorInput";

const SLACK_MS = 30 * 60_000;
/** Share of the finding's window a re-found stop must cover. */
const MIN_COVER = 0.8;

export type RecheckRow = {
  sourceStartAt: Date;
  sourceEndAt: Date;
  sourceLat: number;
  sourceLon: number;
  evidence: unknown;
};

export type Recheck = { outcome: "holds" | "invalidated"; generation: bigint };

type FindingEvidence = {
  kind?: string;
  market?: { areaIds?: string[]; venueType?: VenueType };
  pointDigests?: string[];
};

function stayHolds(points: readonly StayPoint[], row: RecheckRow, truncated: boolean): boolean {
  const from = row.sourceStartAt.getTime();
  const until = row.sourceEndAt.getTime();
  const span = Math.max(1, until - from);
  const source = { lat: row.sourceLat, lon: row.sourceLon };
  return detectStays(points, truncated).some((c) => {
    if (meters(c, source) > RADIUS_METERS * 2) return false;
    const overlap = Math.min(until, c.endAt.getTime()) - Math.max(from, c.startAt.getTime());
    return overlap / span >= MIN_COVER;
  });
}

/** The catalogue cache, read-only: a lookup on accept never spends the map budget. */
const cacheOnly = (store: CatalogStore): CatalogStore => ({
  read: (key) => store.read(key),
  write: async () => {},
  claim: async () => null,
  complete: async () => {},
});

async function venueHolds(
  points: readonly StayPoint[],
  evidence: FindingEvidence,
  store: CatalogStore
): Promise<boolean> {
  const areaIds = new Set(evidence.market?.areaIds ?? []);
  const venueType = evidence.market?.venueType ?? "market";
  const found = new Map<string, Awaited<ReturnType<typeof discoverMarketAreas>>["areas"][number]>();
  // The scan cached its tiles as market or venue tiles, by its consent then.
  for (const includeVenues of [false, true]) {
    const catalog = await discoverMarketAreas(points, {
      store: cacheOnly(store),
      isAllowed: async () => true,
      includeVenues,
    });
    for (const area of catalog.areas) if (areaIds.has(area.id)) found.set(area.id, area);
  }
  if (found.size) {
    return detectMarketVisits(points, [...found.values()]).some(
      (v) => areaIds.has(v.marketId) || v.areaIds.some((id) => areaIds.has(id))
    );
  }
  // No area to test against: the finding's own points must still make the visit.
  const digests = new Set(evidence.pointDigests ?? []);
  const own = points.filter((p) => digests.has(String(p.id)));
  if (own.length < MARKET_RULES.minPoints) return false;
  const minutes = (own[own.length - 1].timestampMs - own[0].timestampMs) / 60_000;
  return minutes >= venueMinimumMinutes(venueType);
}

export async function recheckFinding(
  userId: string,
  row: RecheckRow,
  options: { store?: CatalogStore } = {}
): Promise<Recheck> {
  const read = await readTravTrackDerivation(userId, {
    fromMs: row.sourceStartAt.getTime() - SLACK_MS,
    untilMs: row.sourceEndAt.getTime() + SLACK_MS + 1,
  });
  const points = read.points.filter((p) => !p.inFlight).map(toDetectorInput);
  const evidence = (row.evidence ?? {}) as FindingEvidence;
  const holds =
    evidence.kind === "market" || evidence.kind === "venue"
      ? await venueHolds(points, evidence, options.store ?? marketCatalogStore)
      : stayHolds(points, row, read.coverage === "truncated");
  return { outcome: holds ? "holds" : "invalidated", generation: read.generation };
}
