/**
 * The cities of TravTrack's monthly values (TravTrack plan L3) — only for an
 * account that switched the lookup on (`user_settings.travtrack_city_lookup`).
 *
 *   - A dwell is at least 30 minutes of one privacy-safe stretch within
 *     250 m of where it began, on the ground. Its centroid is rounded to a
 *     0.01° cell (about 1 km), and only the cell's centre is ever looked up:
 *     the geocoder sees a rounded position, never a fix.
 *   - No dwell inside a privacy circle (a zone in force or a former zone's
 *     circle that still covers the read) is looked up or counted: not when its
 *     centroid, any of its points or its cell's centre lies in one.
 *   - Each cell is looked up once for every account through `geo_city_cache`,
 *     which holds the cell, the name and the country — no user, no time, no
 *     track. The geocoder is the codebase's one reverse geocoder
 *     (`geo/nominatim.ts`), which may be a public Nominatim; that is why the
 *     lookup is off by default and its switch says so.
 *   - A lookup that failed (`degraded`) is not cached, so it is retried; an
 *     answer without a settlement is cached as `name: null`.
 */
import { prisma, type DbTransaction } from "../../../db";
import { reverseGeocodeDetailed } from "../../geo/nominatim";
import type { StoredPoint } from "../../tripRecording/segments";
import { distanceM, inPrivacyZone, type ZoneCircle } from "../classify";
import type { InFlight } from "./values";

export const DWELL_MIN_MS = 30 * 60_000;
export const DWELL_RADIUS_M = 250;
/** New cells one projection run sends to the geocoder at most (it allows 1 request/s). */
export const MAX_CITY_LOOKUPS_PER_RUN = 20;

export type CityCell = { cell: string; lat: number; lon: number };
export type City = { name: string; countryCode: string | null };

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The 0.01° cell of a position, and its centre — the only position ever looked up. */
export function cityCellOf(lat: number, lon: number): CityCell {
  const cLat = round2(lat);
  const cLon = round2(lon);
  return { cell: `${cLat.toFixed(2)},${cLon.toFixed(2)}`, lat: cLat, lon: cLon };
}

const pos = (p: StoredPoint) => ({ lat: p[1], lon: p[2] });

/** Every ground dwell of the stretches, as its points. */
function dwells(stretches: readonly StoredPoint[][], inFlight: InFlight): StoredPoint[][] {
  const out: StoredPoint[][] = [];
  for (const stretch of stretches) {
    let start = 0;
    while (start < stretch.length) {
      const anchor = stretch[start];
      let end = start;
      while (
        end + 1 < stretch.length &&
        !inFlight(stretch[end + 1]) &&
        distanceM(pos(anchor), pos(stretch[end + 1])) <= DWELL_RADIUS_M
      ) {
        end += 1;
      }
      if (!inFlight(anchor) && stretch[end][0] - anchor[0] >= DWELL_MIN_MS) {
        out.push(stretch.slice(start, end + 1));
      }
      start = end + 1;
    }
  }
  return out;
}

/** The distinct cells of the stretches' dwells, every one clear of every privacy circle. */
export function dwellCells(
  stretches: readonly StoredPoint[][],
  circles: readonly ZoneCircle[],
  inFlight: InFlight
): CityCell[] {
  const cells = new Map<string, CityCell>();
  for (const dwell of dwells(stretches, inFlight)) {
    const lat = dwell.reduce((s, p) => s + p[1], 0) / dwell.length;
    const lon = dwell.reduce((s, p) => s + p[2], 0) / dwell.length;
    const cell = cityCellOf(lat, lon);
    if (inPrivacyZone({ lat, lon }, circles) || inPrivacyZone(cell, circles)) continue;
    if (dwell.some((p) => inPrivacyZone(pos(p), circles))) continue;
    cells.set(cell.cell, cell);
  }
  return [...cells.values()].sort((a, b) => a.cell.localeCompare(b.cell));
}

/**
 * The cities of these cells from the cache, by name; `missing` names the
 * cells it holds no answer for yet.
 */
export async function citiesFromCache(
  cells: readonly CityCell[],
  db: Pick<DbTransaction, "geoCityCache"> = prisma
): Promise<{ cities: City[]; missing: CityCell[] }> {
  if (cells.length === 0) return { cities: [], missing: [] };
  const rows = await db.geoCityCache.findMany({
    where: { cell: { in: cells.map((c) => c.cell) } },
    select: { cell: true, name: true, countryCode: true },
  });
  const byCell = new Map(rows.map((r) => [r.cell, r]));
  const found = new Map<string, City>();
  const missing: CityCell[] = [];
  for (const c of cells) {
    const row = byCell.get(c.cell);
    if (!row) missing.push(c);
    else if (row.name) {
      found.set(`${row.name}|${row.countryCode ?? ""}`, {
        name: row.name,
        countryCode: row.countryCode,
      });
    }
  }
  const cities = [...found.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || (a.countryCode ?? "").localeCompare(b.countryCode ?? "")
  );
  return { cities, missing };
}

export type CityLookupDeps = {
  /** The reverse geocoder; `reverseGeocodeDetailed` unless a test stands in. */
  geocode?: typeof reverseGeocodeDetailed;
  /** The offline country of a position (ISO alpha-2), the cache's country code. */
  countryAt: (lat: number, lon: number) => string | null;
  max?: number;
};

/**
 * Looks the cells up — their centres, never a fix — and caches each answer.
 * Answers how many were looked up; a failed lookup is not cached.
 */
export async function lookUpCityCells(
  cells: readonly CityCell[],
  deps: CityLookupDeps
): Promise<number> {
  const geocode = deps.geocode ?? reverseGeocodeDetailed;
  let looked = 0;
  for (const c of cells.slice(0, deps.max ?? MAX_CITY_LOOKUPS_PER_RUN)) {
    const outcome = await geocode(c.lat, c.lon);
    looked += 1;
    if (outcome.degraded) continue;
    const data = { name: outcome.parts?.city ?? null, countryCode: deps.countryAt(c.lat, c.lon) };
    await prisma.geoCityCache.upsert({
      where: { cell: c.cell },
      create: { cell: c.cell, ...data },
      update: { ...data, fetchedAt: new Date() },
    });
  }
  return looked;
}
