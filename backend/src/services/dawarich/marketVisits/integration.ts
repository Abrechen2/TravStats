import { createHash } from "node:crypto";
import type { DawarichPoint } from "../dawarichClient";
import type { StayCandidate } from "../stays/detect";
import { discoverMarketAreas, type CatalogStore } from "./catalog";
import { marketCatalogStore } from "./catalogStore";
import { prepareMarketAreas } from "./areas";
import { detectMarketVisits } from "./detect";
import {
  matchesMarketPlace,
  previewMarketVisit,
  type KnownPlace,
  type KnownTrip,
  type KnownVisit,
} from "./preview";
import { contains, type MarketArea } from "./geometry";
export interface MarketFinding extends StayCandidate {
  name: string;
  placeId: string | null;
  tripId: string | null;
  market: {
    identity: string;
    osmRef: string;
    areaIds: string[];
    sourceUrls: string[];
    interiorPointCount: number;
    overlappingMarketIds: string[];
  };
}
export async function collectMarketFindings(
  points: readonly DawarichPoint[],
  known: { places: KnownPlace[]; visits: KnownVisit[]; trips: KnownTrip[] },
  options: {
    isAllowed: () => Promise<boolean>;
    store?: CatalogStore;
    endpoint?: string;
    fetcher?: typeof fetch;
  }
) {
  const catalog = await discoverMarketAreas(points, {
    ...options,
    store: options.store ?? marketCatalogStore,
  });
  const prepared = prepareMarketAreas(catalog.areas);
  const hits = detectMarketVisits(points, catalog.areas);
  const byId = new Map(points.map((p) => [p.id, p]));
  const findings: MarketFinding[] = [];
  for (const hit of hits) {
    const area = prepared.find((a) => a.id === hit.marketId)!;
    const reviewed = previewMarketVisit(hit, area, known);
    if (reviewed.status === "alreadyRecorded") {
      catalog.coverage.alreadyRecordedCount++;
      continue;
    }
    const interior = hit.pointIds
      .map((id) => byId.get(id)!)
      .filter((p) => p && contains(area, p.longitude, p.latitude));
    const representative = interior[Math.floor(interior.length / 2)];
    if (!representative) continue;
    const identity = area.entityRef ?? area.id;
    const own = known.places.filter((p) => matchesMarketPlace(p, area));
    findings.push({
      startAt: hit.startAt,
      endAt: hit.endAt,
      lat: representative.latitude,
      lon: representative.longitude,
      pointIds: hit.pointIds,
      pointCount: hit.pointIds.length,
      maxGapMinutes: hit.maxGapMinutes,
      name: area.name,
      placeId: own.length === 1 ? own[0].id : null,
      tripId: reviewed.tripId,
      uncertainties: [
        ...reviewed.uncertainties,
        ...(catalog.coverage.staleTiles ? ["staleMapData"] : []),
        ...(catalog.coverage.status !== "complete" ? ["partialMapData"] : []),
        ...(reviewed.status === "reviewConflict" ? ["visitAmbiguous"] : []),
      ],
      market: {
        identity,
        osmRef: area.id,
        areaIds: hit.areaIds,
        sourceUrls: hit.sourceUrls,
        interiorPointCount: hit.interiorPointCount,
        overlappingMarketIds: hit.overlappingMarketIds,
      },
    });
  }
  return { findings, coverage: catalog.coverage, hits, areas: prepared };
}
export function marketFingerprint(candidate: MarketFinding): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "market",
        candidate.market.identity,
        candidate.startAt.toISOString(),
        candidate.endAt.toISOString(),
      ])
    )
    .digest("hex");
}
/** Any raw stationary fragment supported by the SAME market visit is redundant. */
export function isMarketFragment(
  candidate: StayCandidate,
  markets: Awaited<ReturnType<typeof collectMarketFindings>>
): boolean {
  for (const hit of markets.hits) {
    if (candidate.startAt > hit.endAt || candidate.endAt < hit.startAt) continue;
    const ids = new Set(hit.pointIds);
    if (candidate.pointIds.filter((id) => ids.has(id)).length >= 3) return true;
    const area = markets.areas.find((a) => a.id === hit.marketId) as MarketArea;
    if (area && contains(area, candidate.lon, candidate.lat)) return true;
  }
  return false;
}
