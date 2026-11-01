/**
 * One place search for every TravPlan picker (spec §5.6): the account's own places, ports and the
 * geocoder, merged. Each source that fails is NAMED in `unavailable` instead of vanishing - a
 * picker that silently dropped the geocoder would look like "no such place" (CLAUDE.md, failure
 * class 3). A pick carries name, coordinates, country and zone, so no form waits on them after.
 */
import { prisma } from "../../db";
import { isoCountryCode } from "../../utils/continents";
import { findLocations } from "./locations";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { zoneOfCoordinates } from "../../shared/time/resolveInput";
import type { PlanPlace } from "./types";

export type PlaceSource = "own" | "port" | "geocoder";
export interface PlaceHit {
  source: PlaceSource;
  /** How many times the account has been there (own places only). */
  visits: number | null;
  place: PlanPlace;
}
export interface PlaceSearchResult {
  places: PlaceHit[];
  /** Sources that could not answer, each with its own reason code. */
  unavailable: { source: PlaceSource; code: string }[];
}

const like = (q: string) => ({ contains: q, mode: "insensitive" as const });

/** The coordinate's zone; a failing lookup leaves it unset (the plan then falls back to its own). */
function zoneOf(lat: number, lon: number): string | null {
  try {
    return zoneOfCoordinates(lat, lon);
  } catch (error) {
    logger.warn({ operation: "travplan.places.zone", error: String(error) }, "zone lookup failed");
    return null;
  }
}

async function ownPlaces(userId: string, q: string): Promise<PlaceHit[]> {
  const rows = await prisma.place.findMany({
    where: { userId, OR: [{ name: like(q) }, { city: like(q) }] },
    select: {
      id: true,
      name: true,
      lat: true,
      lon: true,
      country: true,
      isoCountryCode: true,
      _count: { select: { visits: true } },
    },
    orderBy: { name: "asc" },
    take: 6,
  });
  return rows.map((r) => ({
    source: "own",
    visits: r._count.visits,
    place: {
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      country: r.isoCountryCode ?? isoCountryCode(r.country) ?? r.country,
      // A saved place has no zone column: derive it from where it is, so the pick carries one.
      zone: zoneOf(r.lat, r.lon),
      ref: { kind: "place", id: r.id },
    },
  }));
}

async function ports(q: string): Promise<PlaceHit[]> {
  const rows = await prisma.port.findMany({
    where: { OR: [{ name: like(q) }, { city: like(q) }] },
    orderBy: { name: "asc" },
    take: 6,
  });
  return rows.map((r) => ({
    source: "port",
    visits: null,
    place: {
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      country: isoCountryCode(r.country) ?? r.country,
      zone: r.timezone,
      ref: { kind: "port", id: String(r.id) },
    },
  }));
}

async function geocoder(userId: string, q: string, language: "de" | "en"): Promise<PlaceHit[]> {
  const rows = await findLocations(userId, q, language);
  return rows.map((r) => ({
    source: "geocoder",
    visits: null,
    place: {
      name: r.admin1 ? `${r.name}, ${r.admin1}` : r.name,
      lat: r.latitude,
      lon: r.longitude,
      country: isoCountryCode(r.country) ?? r.country ?? null,
      zone: r.timezone,
      ref: { kind: "geo", id: String(r.id) },
    },
  }));
}

export async function searchPlaces(
  userId: string,
  q: string,
  language: "de" | "en",
  kind: "any" | "port" = "any"
): Promise<PlaceSearchResult> {
  const sources: [PlaceSource, () => Promise<PlaceHit[]>][] = [
    ["own", () => ownPlaces(userId, q)],
    ["port", () => ports(q)],
  ];
  if (kind === "any") sources.push(["geocoder", () => geocoder(userId, q, language)]);
  const settled = await Promise.allSettled(sources.map(([, run]) => run()));
  const places: PlaceHit[] = [];
  const unavailable: PlaceSearchResult["unavailable"] = [];
  settled.forEach((outcome, i) => {
    const source = sources[i][0];
    if (outcome.status === "fulfilled") return void places.push(...outcome.value);
    const reason = outcome.reason;
    const code = reason instanceof AppError && reason.code ? reason.code : "PLACE_SOURCE_FAILED";
    logger.warn({ operation: "travplan.places", source, code }, "place source unavailable");
    unavailable.push({ source, code });
  });
  return { places, unavailable };
}
