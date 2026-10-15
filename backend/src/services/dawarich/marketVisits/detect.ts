import { createHash } from "node:crypto";
import type { DawarichPoint } from "../dawarichClient";
import { meters } from "../stays/detect";
import { contains, distanceToArea, polygons, type MarketArea } from "./geometry";

import { prepareMarketAreas } from "./areas";

const MINUTE = 60_000;
export const MARKET_RULES = Object.freeze({
  minMinutes: 5,
  minPoints: 5,
  minInteriorPoints: 3,
  minInteriorMinutes: 2,
  maxGapMinutes: 10,
  maxExcursionMinutes: 2,
  boundaryToleranceMeters: 20,
  maxAccuracyMeters: 100,
  maxWalkingMetersPerSecond: 3,
});

export interface MarketVisit {
  fingerprint: string;
  marketId: string;
  name: string;
  sourceUrl: string;
  areaIds: string[];
  sourceUrls: string[];
  overlappingMarketIds: string[];
  startAt: Date;
  endAt: Date;
  pointIds: number[];
  interiorPointCount: number;
  maxGapMinutes: number;
  uncertainties: string[];
}
interface Hit {
  point: DawarichPoint;
  interior: boolean;
  speedUnknown: boolean;
}

/** Pure preview: no fetching, database, visit creation or AI. */
export function detectMarketVisits(
  input: readonly DawarichPoint[],
  areas: readonly MarketArea[]
): MarketVisit[] {
  const prepared = prepareMarketAreas(areas);
  const byTime = new Map<number, DawarichPoint>();
  for (const p of input) {
    if (
      !Number.isFinite(p.timestampMs) ||
      !Number.isFinite(p.id) ||
      !Number.isFinite(p.latitude) ||
      !Number.isFinite(p.longitude) ||
      Math.abs(p.latitude) > 90 ||
      Math.abs(p.longitude) > 180 ||
      (p.accuracy !== null &&
        (!Number.isFinite(p.accuracy) ||
          p.accuracy < 0 ||
          p.accuracy > MARKET_RULES.maxAccuracyMeters)) ||
      (p.velocity !== null && (!Number.isFinite(p.velocity) || p.velocity < 0))
    )
      continue;
    const old = byTime.get(p.timestampMs);
    if (
      !old ||
      (p.accuracy ?? Infinity) < (old.accuracy ?? Infinity) ||
      ((p.accuracy ?? Infinity) === (old.accuracy ?? Infinity) && p.id < old.id)
    )
      byTime.set(p.timestampMs, p);
  }
  const points = [...byTime.values()].sort((a, b) => a.timestampMs - b.timestampMs);
  const result: MarketVisit[] = [];
  // A supplied parent market represents its stalls and smaller parts.
  for (const area of prepared) {
    const vertices = polygons(area).flat(2);
    const latitudePadding = MARKET_RULES.boundaryToleranceMeters / 111_320;
    const furthestLatitude = Math.max(...vertices.map((p) => Math.abs(p[1])));
    const longitudePadding =
      latitudePadding / Math.max(0.000001, Math.cos((furthestLatitude * Math.PI) / 180));
    const minLon = Math.min(...vertices.map((p) => p[0])) - longitudePadding;
    const maxLon = Math.max(...vertices.map((p) => p[0])) + longitudePadding;
    const minLat = Math.min(...vertices.map((p) => p[1])) - latitudePadding;
    const maxLat = Math.max(...vertices.map((p) => p[1])) + latitudePadding;
    let group: Hit[] = [];
    let outsideSince: number | null = null;
    let excursion = false;
    const flush = () => {
      const first = group[0],
        last = group[group.length - 1];
      const interior = group.filter((h) => h.interior);
      if (
        first &&
        last &&
        group.length >= MARKET_RULES.minPoints &&
        last.point.timestampMs - first.point.timestampMs >= MARKET_RULES.minMinutes * MINUTE &&
        interior.length >= MARKET_RULES.minInteriorPoints &&
        interior[interior.length - 1].point.timestampMs - interior[0].point.timestampMs >=
          MARKET_RULES.minInteriorMinutes * MINUTE
      ) {
        const maxGapMinutes = group
          .slice(1)
          .reduce(
            (max, h, i) =>
              Math.max(max, (h.point.timestampMs - group[i].point.timestampMs) / MINUTE),
            0
          );
        result.push({
          fingerprint: createHash("sha256")
            .update(JSON.stringify([area.id, first.point.timestampMs, last.point.timestampMs]))
            .digest("hex"),
          marketId: area.id,
          name: area.name,
          sourceUrl: area.sourceUrl,
          areaIds: area.areaIds,
          sourceUrls: area.sourceUrls,
          overlappingMarketIds: [],
          startAt: new Date(first.point.timestampMs),
          endAt: new Date(last.point.timestampMs),
          pointIds: group.map((h) => h.point.id),
          interiorPointCount: interior.length,
          maxGapMinutes,
          uncertainties: [
            "sourceUnknown",
            ...(group.some((h) => h.point.accuracy === null) ? ["accuracyUnknown"] : []),
            ...(group.some((h) => h.speedUnknown) ? ["speedUnknown"] : []),
            ...(group.some((h) => !h.interior) ? ["boundaryTolerance"] : []),
            ...(maxGapMinutes > 2 ? ["signalGaps"] : []),
            ...(excursion ? ["briefExcursion"] : []),
          ],
        });
      }
      group = [];
      outsideSince = null;
      excursion = false;
    };
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (
        group.length &&
        p.timestampMs - group[group.length - 1].point.timestampMs >
          MARKET_RULES.maxGapMinutes * MINUTE
      )
        flush();
      const inBounds =
        p.longitude >= minLon &&
        p.longitude <= maxLon &&
        p.latitude >= minLat &&
        p.latitude <= maxLat;
      const interior = inBounds && contains(area, p.longitude, p.latitude);
      const near =
        inBounds &&
        (interior ||
          distanceToArea(area, p.longitude, p.latitude) <= MARKET_RULES.boundaryToleranceMeters);
      const previous = points[i - 1];
      const elapsed = previous ? (p.timestampMs - previous.timestampMs) / 1000 : Infinity;
      // A missing speed is inferred only across a short, actually observed interval.
      const inferred =
        previous && elapsed > 0 && elapsed <= 120
          ? Math.max(
              0,
              meters(
                { lat: previous.latitude, lon: previous.longitude },
                { lat: p.latitude, lon: p.longitude }
              ) -
                (previous.accuracy ?? 0) -
                (p.accuracy ?? 0)
            ) / elapsed
          : null;
      const speed =
        p.velocity === null
          ? inferred
          : inferred === null
            ? p.velocity
            : Math.max(p.velocity, inferred);
      if (!near || (speed !== null && speed > MARKET_RULES.maxWalkingMetersPerSecond)) {
        if (group.length && outsideSince === null) outsideSince = p.timestampMs;
        continue;
      }
      if (outsideSince !== null) {
        if (p.timestampMs - outsideSince >= MARKET_RULES.maxExcursionMinutes * MINUTE) flush();
        else excursion = true;
        outsideSince = null;
      }
      group.push({ point: p, interior, speedUnknown: speed === null });
    }
    flush();
  }
  // Conflicting public areas stay separate and explicitly require review.
  // Never resolve overlapping venues by picking whichever one came first.
  for (let i = 0; i < result.length; i++) {
    const ids = new Set(result[i].pointIds);
    for (let j = i + 1; j < result.length; j++) {
      if (
        result[i].marketId === result[j].marketId ||
        result[i].startAt > result[j].endAt ||
        result[j].startAt > result[i].endAt
      )
        continue;
      if (result[j].pointIds.filter((id) => ids.has(id)).length < 3) continue;
      for (const [a, b] of [
        [result[i], result[j]],
        [result[j], result[i]],
      ]) {
        if (!a.uncertainties.includes("overlappingMarkets"))
          a.uncertainties.push("overlappingMarkets");
        if (!a.overlappingMarketIds.includes(b.marketId)) a.overlappingMarketIds.push(b.marketId);
      }
    }
  }
  return result.sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime() || a.marketId.localeCompare(b.marketId)
  );
}
