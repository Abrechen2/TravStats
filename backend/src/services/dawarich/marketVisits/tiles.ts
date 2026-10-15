import type { DawarichPoint } from "../dawarichClient";
export interface MarketTile {
  key: string;
  south: number;
  west: number;
  north: number;
  east: number;
}
export const TILE_SIZE = 0.05;
export const MAX_SCAN_TILES = 48;
/** Coarse public regions only. Never include point ids, times or exact positions in a query. */
export function planMarketTiles(points: readonly DawarichPoint[]) {
  const cells = new Map<string, { tile: MarketTile; times: Set<number> }>();
  for (const p of points) {
    if (
      !Number.isFinite(p.latitude) ||
      !Number.isFinite(p.longitude) ||
      Math.abs(p.latitude) > 90 ||
      Math.abs(p.longitude) > 180 ||
      !Number.isFinite(p.timestampMs)
    )
      continue;
    if (p.accuracy !== null && (!Number.isFinite(p.accuracy) || p.accuracy < 0 || p.accuracy > 100))
      continue;
    if (p.velocity !== null && (!Number.isFinite(p.velocity) || p.velocity < 0 || p.velocity > 3))
      continue;
    const row = Math.min(3599, Math.floor((p.latitude + 90) / TILE_SIZE));
    const col = Math.min(7199, Math.floor((p.longitude + 180) / TILE_SIZE));
    const key = `${row}:${col}`;
    const south = +(row * TILE_SIZE - 90).toFixed(5),
      west = +(col * TILE_SIZE - 180).toFixed(5);
    const entry = cells.get(key) ?? {
      tile: {
        key,
        south: Math.max(-90, south - 0.003),
        west: Math.max(-180, west - 0.003),
        north: Math.min(90, +(south + TILE_SIZE + 0.003).toFixed(5)),
        east: Math.min(180, +(west + TILE_SIZE + 0.003).toFixed(5)),
      },
      times: new Set<number>(),
    };
    entry.times.add(p.timestampMs);
    cells.set(key, entry);
  }
  const eligible = [...cells.values()]
    .filter((c) => {
      const times = [...c.times].sort((a, b) => a - b);
      // At least one actually observed five-minute window, not two fly-bys days apart.
      let start = 0;
      for (let i = 0; i < times.length; i++) {
        if (i && times[i] - times[i - 1] > 10 * 60_000) start = i;
        if (i - start >= 4 && times[i] - times[start] >= 5 * 60_000) return true;
      }
      return false;
    })
    .sort((a, b) => b.times.size - a.times.size || a.tile.key.localeCompare(b.tile.key));
  return {
    tiles: eligible.slice(0, MAX_SCAN_TILES).map((c) => c.tile),
    limited: eligible.length > MAX_SCAN_TILES,
    totalTiles: eligible.length,
  };
}
export function marketTileQuery(tile: MarketTile): string {
  const bbox = [tile.south, tile.west, tile.north, tile.east].map((n) => n.toFixed(5)).join(",");
  return `[out:json][timeout:12][maxsize:8388608];(nwr["amenity"="marketplace"](${bbox});wr["name:en"~"market",i](${bbox}););out body geom;`;
}
