import { createHash } from "node:crypto";
import { planMarketTiles, marketTileQuery, type MarketTile } from "./tiles";
import { parseMarketCatalog, type MarketCatalog } from "./osm";
import type { DawarichPoint } from "../dawarichClient";
export const CATALOG_TTL_MS = 14 * 86400000;
export const CATALOG_STALE_MS = 90 * 86400000;
export const MAX_CATALOG_BYTES = 4_000_000;
export interface CachedCatalog {
  payload: MarketCatalog;
  fetchedAt: Date;
}
export interface CatalogStore {
  read(key: string): Promise<CachedCatalog | null>;
  write(key: string, value: MarketCatalog, at: Date): Promise<void>;
  claim(at: Date): Promise<Date | null>;
  complete(token: Date, bytes: number, backoffMs: number): Promise<void>;
}
export interface MarketCoverage {
  scope?: "markets" | "venues";
  status: "complete" | "partial" | "cancelled";
  tiles: number;
  totalTiles: number;
  cachedTiles: number;
  fetchedTiles: number;
  staleTiles: number;
  failedTiles: number;
  missingAreaCount: number;
  invalidAreaCount: number;
  limited: boolean;
  alreadyRecordedCount: number;
  createdCount: number;
}
export const emptyCoverage = (): MarketCoverage => ({
  status: "complete",
  tiles: 0,
  totalTiles: 0,
  cachedTiles: 0,
  fetchedTiles: 0,
  staleTiles: 0,
  failedTiles: 0,
  missingAreaCount: 0,
  invalidAreaCount: 0,
  limited: false,
  alreadyRecordedCount: 0,
  createdCount: 0,
});
class CatalogFailure extends Error {
  constructor(
    public backoffMs: number,
    public bytes = 0
  ) {
    super("Map data unavailable");
  }
}
export async function fetchMarketTile(
  tile: MarketTile,
  endpoint: string,
  fetcher: typeof fetch = fetch,
  includeVenues = false
): Promise<{ value: MarketCatalog; bytes: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 16000);
  let bytes = 0;
  try {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("endpoint");
    url.searchParams.set("data", marketTileQuery(tile, includeVenues));
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "TravStats/2.0 (+https://travstats.de)",
        Accept: "application/json",
      },
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      const retry = Number(response.headers.get("retry-after"));
      throw new CatalogFailure(
        [406, 429].includes(response.status)
          ? Math.max(30000, Number.isFinite(retry) ? Math.min(retry * 1000, 3600000) : 30000)
          : 30000
      );
    }
    if (Number(response.headers.get("content-length")) > MAX_CATALOG_BYTES || !response.body) {
      await response.body?.cancel();
      throw new CatalogFailure(30000);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > MAX_CATALOG_BYTES) {
        await reader.cancel();
        throw new CatalogFailure(30000);
      }
      chunks.push(next.value);
    }
    const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { value: parseMarketCatalog(raw, includeVenues), bytes };
  } catch (e) {
    if (e instanceof CatalogFailure) {
      e.bytes = bytes;
      throw e;
    }
    throw new CatalogFailure(30000, bytes);
  } finally {
    clearTimeout(timer);
  }
}
/** Public cached tiles, bounded sequential requests; no raw track is sent upstream. */
export async function discoverMarketAreas(
  points: readonly DawarichPoint[],
  options: {
    store: CatalogStore;
    isAllowed: () => Promise<boolean>;
    endpoint?: string;
    fetcher?: typeof fetch;
    clock?: () => Date;
    includeVenues?: boolean;
  }
) {
  const clock = options.clock ?? (() => new Date());
  const endpoint =
    options.endpoint ??
    process.env.MARKET_OVERPASS_URL ??
    "https://overpass-api.de/api/interpreter";
  const prefix = createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
  const plan = planMarketTiles(points);
  const coverage = emptyCoverage();
  coverage.scope = options.includeVenues ? "venues" : "markets";
  coverage.totalTiles = plan.totalTiles;
  coverage.limited = plan.limited;
  const areas = new Map<string, MarketCatalog["areas"][number]>(),
    missing = new Map<string, MarketCatalog["missingAreas"][number]>();
  let calls = 0,
    networkBlocked = false;
  for (const tile of plan.tiles) {
    if (!(await options.isAllowed())) {
      coverage.status = "cancelled";
      break;
    }
    const at = clock(),
      key = `${options.includeVenues ? "venue-v1" : "market-v1"}:${prefix}:${tile.key}`;
    const cached = await options.store.read(key);
    let data: MarketCatalog | null = null;
    if (cached && at.getTime() - cached.fetchedAt.getTime() <= CATALOG_TTL_MS) {
      data = cached.payload;
      coverage.cachedTiles++;
    } else {
      if (!networkBlocked && calls < 24) {
        const token = await options.store.claim(at);
        if (token) {
          calls++;
          let bytes = 0,
            backoff = 0;
          try {
            if (!(await options.isAllowed())) {
              coverage.status = "cancelled";
              break;
            }
            const result = await fetchMarketTile(
              tile,
              endpoint,
              options.fetcher,
              options.includeVenues
            );
            bytes = result.bytes;
            if (!(await options.isAllowed())) {
              coverage.status = "cancelled";
              break;
            }
            data = result.value;
            coverage.fetchedTiles++;
            await options.store.write(key, data, clock());
          } catch (e) {
            backoff = e instanceof CatalogFailure ? e.backoffMs : 30000;
            bytes = e instanceof CatalogFailure ? e.bytes : 0;
            networkBlocked = true;
          } finally {
            await options.store.complete(token, bytes, backoff);
          }
        } else networkBlocked = true;
      }
      if (!data && cached && at.getTime() - cached.fetchedAt.getTime() <= CATALOG_STALE_MS) {
        data = cached.payload;
        coverage.staleTiles++;
      }
      if (!data) coverage.failedTiles++;
    }
    if (data) {
      coverage.tiles++;
      coverage.invalidAreaCount += data.invalidCount;
      for (const a of data.areas) areas.set(a.id, a);
      for (const m of data.missingAreas) missing.set(m.id, m);
    }
  }
  coverage.missingAreaCount = missing.size;
  // A broken boundary is skipped (and logged when parsed), not a gap in the
  // coverage: it lives in the cached tile, so counting it here kept every scan
  // of its region `partial` for as long as OSM kept the broken relation.
  if (
    coverage.status !== "cancelled" &&
    (coverage.limited || coverage.failedTiles || coverage.staleTiles)
  )
    coverage.status = "partial";
  return { areas: [...areas.values()], missingAreas: [...missing.values()], coverage };
}
