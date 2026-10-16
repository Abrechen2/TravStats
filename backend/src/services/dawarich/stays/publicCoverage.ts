import type { MarketCoverage } from "../marketVisits/catalog";

/**
 * What an account may learn about its own market/venue scan.
 *
 * The OSM tile cache (`market_catalog_tiles`) is shared by every account on the
 * instance, so "N tiles came from stored map data" told a user that SOMEONE had
 * scanned those tiles recently — another account's whereabouts, read off a
 * counter. The cache/fetch split is therefore never published; what stays is
 * what this scan covered, what failed and what it found. Stale map data is
 * reduced to a yes/no, because the user still has to be told to check the
 * suggestions carefully.
 */
export interface PublicMarketCoverage {
  scope?: "markets" | "venues";
  status: MarketCoverage["status"];
  tiles: number;
  totalTiles: number;
  failedTiles: number;
  missingAreaCount: number;
  invalidAreaCount: number;
  limited: boolean;
  alreadyRecordedCount: number;
  createdCount: number;
  staleMapData: boolean;
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Also reads rows stored before this rule, which still carry the raw counters. */
export function publicMarketCoverage(raw: unknown): PublicMarketCoverage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Partial<MarketCoverage> & { staleMapData?: unknown };
  const status = c.status === "partial" || c.status === "cancelled" ? c.status : "complete";
  return {
    ...(c.scope === "markets" || c.scope === "venues" ? { scope: c.scope } : {}),
    status,
    tiles: count(c.tiles),
    totalTiles: count(c.totalTiles),
    failedTiles: count(c.failedTiles),
    missingAreaCount: count(c.missingAreaCount),
    invalidAreaCount: count(c.invalidAreaCount),
    limited: c.limited === true,
    alreadyRecordedCount: count(c.alreadyRecordedCount),
    createdCount: count(c.createdCount),
    staleMapData: c.staleMapData === true || count(c.staleTiles) > 0,
  };
}
