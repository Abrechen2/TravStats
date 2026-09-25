import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import type { RailStationInput } from "../../schemas/rail";
import { calculateDistance } from "../../utils/geo";

/**
 * The station catalogue (`rail_stations`, Trainline stations.csv, ODbL):
 * search, and turning a picked catalogue row into a journey's station columns.
 */

export interface RailStationHit {
  id: number;
  name: string;
  uic: string | null;
  dbId: string | null;
  lat: number;
  lon: number;
  country: string | null;
  timezone: string | null;
}

/**
 * What search compares: lower case, diacritics folded, every run of
 * punctuation one space. "Zürich HB" and "zurich hb" meet at "zurich hb";
 * "Frankfurt (Main) Hbf" becomes "frankfurt main hbf", so "frankfurt hbf"
 * finds it token by token. The seeder writes the column with this function
 * and the search folds the query with it — one rule on both sides.
 */
export function foldStationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const HIT_SELECT = {
  id: true,
  name: true,
  uic: true,
  dbId: true,
  lat: true,
  lon: true,
  country: true,
  timezone: true,
} as const satisfies Prisma.RailStationSelect;

const MAX_TOKENS = 5;
/** A UIC or EVA code as typed: seven or eight digits. */
const STATION_CODE = /^\d{7,8}$/;

/**
 * Up to `limit` stations for a typeahead. A seven- or eight-digit query is a
 * code and matches UIC or EVA exactly; anything else must contain every word
 * of the query at the start of a word. Ranked: a name that STARTS with the query first, then rows
 * that carry a rail code (the catalogue also lists 21 k Swiss bus stops
 * without one), then shorter names ("Basel SBB" before "Basel SBB
 * Güterbahnhof").
 */
export async function searchStations(query: string, limit: number): Promise<RailStationHit[]> {
  const trimmed = query.trim();
  if (STATION_CODE.test(trimmed)) {
    return prisma.railStation.findMany({
      where: { OR: [{ uic: trimmed }, { dbId: trimmed }] },
      select: HIT_SELECT,
      orderBy: { id: "asc" },
      take: limit,
    });
  }
  const folded = foldStationName(trimmed);
  const tokens = folded.split(" ").filter(Boolean).slice(0, MAX_TOKENS);
  if (tokens.length === 0) return [];
  // Each word must START a word of the name ("hb" finds "Zürich HB", not
  // "Frohburg"). The plain containment test is kept beside it because it is
  // the one the trigram index can answer; the word test then filters.
  // Tokens are letters and digits only after folding, so they cannot carry a
  // LIKE wildcard; they are bound parameters all the same, never spliced.
  const conditions = tokens.map(
    (t) => Prisma.sql`(search_name LIKE ${`%${t}%`} AND (' ' || search_name) LIKE ${`% ${t}%`})`
  );
  return prisma.$queryRaw<RailStationHit[]>(Prisma.sql`
    SELECT id, name, uic, db_id AS "dbId", lat, lon, country, timezone
    FROM rail_stations
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY (search_name LIKE ${`${folded}%`}) DESC,
             (uic IS NOT NULL OR db_id IS NOT NULL) DESC,
             length(search_name) ASC,
             name ASC,
             id ASC
    LIMIT ${limit}
  `);
}

export async function findStation(id: number): Promise<RailStationHit | null> {
  return prisma.railStation.findUnique({ where: { id }, select: HIT_SELECT });
}

/** A catalogue stop "is" a timetable stop within this distance. */
const SAME_STATION_KM = 0.3;
const BOX_DEG = 0.01;

/**
 * The catalogue row at a position, preferring one with a rail code — how a
 * lookup's stops (named by the provider) are tied back to the catalogue.
 * Null when nothing lies within 300 m.
 */
export async function catalogueStationAt(lat: number, lon: number): Promise<RailStationHit | null> {
  const candidates = await prisma.railStation.findMany({
    where: {
      lat: { gte: lat - BOX_DEG, lte: lat + BOX_DEG },
      lon: { gte: lon - BOX_DEG, lte: lon + BOX_DEG },
    },
    select: HIT_SELECT,
    take: 50,
  });
  const ranked = candidates
    .map((s) => ({ s, km: calculateDistance(lat, lon, s.lat, s.lon) }))
    .filter((c) => c.km <= SAME_STATION_KM)
    .sort((a, b) => Number(b.s.uic !== null) - Number(a.s.uic !== null) || a.km - b.km);
  return ranked[0]?.s ?? null;
}

/**
 * A station as a journey stores it. With a `stationId` the catalogue row is
 * the authority for the position, the code and the country — the client sent
 * them too, but a pin in the wrong place is the one mistake this column set
 * exists to prevent. The name stays the client's, which is the catalogue's
 * name unless the user reworded it. An unknown id is refused, not ignored.
 */
export async function resolveStationInput(station: RailStationInput): Promise<RailStationInput> {
  if (station.stationId === undefined || station.stationId === null) {
    return { ...station, stationId: null };
  }
  const row = await findStation(station.stationId);
  if (!row) throw new AppError("Unknown station", 400);
  return {
    ...station,
    code: row.uic ?? station.code ?? null,
    lat: row.lat,
    lon: row.lon,
    country: row.country ?? station.country ?? null,
  };
}
