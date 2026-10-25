/**
 * What one finding of a stay scan is written as (split from `scanCandidates.ts`,
 * TravTrack plan E3): its fingerprint, its evidence and its neutral key.
 *
 * A Dawarich finding keeps exactly the fingerprint and evidence it always had
 * (numeric `pointIds`). A TravTrack finding's fingerprint IS its evidence key,
 * and its evidence names its points by digest — never by id — and carries an
 * explanation and the read's coverage.
 */
import { createHash } from "crypto";
import { explanation } from "../../locationEvidence/envelope";
import { stayEvidenceKey } from "../../locationEvidence/key";
import type { Coverage } from "../../locationProvider/types";
import { marketFingerprint, type MarketFinding } from "../marketVisits/integration";
import { MARKET_RULES } from "../marketVisits/detect";
import { RADIUS_METERS, type PointId, type StayCandidate, type StayPoint } from "./detect";
import type { StaySourceKind } from "./availability";

/** Digests a TravTrack finding keeps; the first and the last always among them. */
const MAX_POINT_DIGESTS = 20_000;

/** The ids a stored finding names its points by, as far as `source` may compare them. */
export function storedPointIds(
  row: { provider: string; evidence: unknown },
  source: StaySourceKind
): readonly PointId[] | undefined {
  const evidence = (row.evidence ?? {}) as { pointIds?: number[]; pointDigests?: string[] };
  if (source === "dawarich") return evidence.pointIds;
  return row.provider === "travtrack" ? evidence.pointDigests : undefined;
}

const capped = (ids: readonly PointId[]): PointId[] =>
  ids.length <= MAX_POINT_DIGESTS
    ? [...ids]
    : [...ids.slice(0, MAX_POINT_DIGESTS - 1), ids[ids.length - 1]];

/** The candidate's provider-neutral key, from its first and last fix. */
export function evidenceKeyOf(
  c: StayCandidate,
  byId: ReadonlyMap<PointId, StayPoint>
): string | null {
  const first = byId.get(c.pointIds[0]);
  const last = byId.get(c.pointIds[c.pointIds.length - 1]);
  if (!first || !last) return null;
  const keyed = (p: StayPoint) => ({ atMs: p.timestampMs, lat: p.latitude, lon: p.longitude });
  return stayEvidenceKey({
    first: keyed(first),
    last: keyed(last),
    startMs: c.startAt.getTime(),
    endMs: c.endAt.getTime(),
    lat: c.lat,
    lon: c.lon,
  });
}

export function findingKind(market: MarketFinding): "market" | "venue" {
  return market.market.venueType && market.market.venueType !== "market" ? "venue" : "market";
}

/** TravTrack: the evidence key. Dawarich: today's market or stop fingerprint. */
export function findingFingerprint(
  source: StaySourceKind,
  c: StayCandidate,
  market: MarketFinding | null,
  evidenceKey: string | null
): string {
  if (source === "travtrack" && evidenceKey) return evidenceKey;
  if (market) return marketFingerprint(market);
  return createHash("sha256")
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
}

export function findingEvidence(
  c: StayCandidate,
  f: {
    market: MarketFinding | null;
    kind: "market" | "venue" | null;
    supersededFindingIds: string[];
    matchingVisitId: string | null;
    zone: string;
    uncertainties: string[];
    travtrack: { readCoverage: Coverage } | null;
  }
) {
  const marketEvidence = f.market
    ? { kind: f.kind, market: f.market.market, supersededFindingIds: f.supersededFindingIds }
    : {};
  if (!f.travtrack)
    return {
      source: "dawarich",
      ...marketEvidence,
      matchingVisitId: f.matchingVisitId,
      zone: f.zone,
      pointIds: c.pointIds,
      maxGapMinutes: c.maxGapMinutes,
      uncertainties: f.uncertainties,
    };
  return {
    source: "travtrack",
    ...marketEvidence,
    matchingVisitId: f.matchingVisitId,
    zone: f.zone,
    pointDigests: capped(c.pointIds),
    maxGapMinutes: c.maxGapMinutes,
    uncertainties: f.uncertainties,
    readCoverage: f.travtrack.readCoverage,
    explanation: explanation(f.kind ? `${f.kind}.visit` : "stay.dwell", {
      minutes: Math.round((c.endAt.getTime() - c.startAt.getTime()) / 60_000),
      points: c.pointCount,
      radiusM: f.market ? MARKET_RULES.boundaryToleranceMeters : RADIUS_METERS,
      maxGapMinutes: Math.round(c.maxGapMinutes * 10) / 10,
    }),
  };
}
