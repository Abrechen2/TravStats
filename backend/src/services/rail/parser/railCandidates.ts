import { prisma } from "../../../db";
import { foldStationName } from "../railStations";
import { instantToWallClock } from "../railJourneyWrite";
import { calculateDistance } from "../../../utils/geo";
import { zoneOf } from "../../../shared/time/zoneOf";
import {
  loadReservationCandidates,
  matchReservation,
  withoutSharedTargets,
  type ReservationMatch,
  type ReservationStation,
} from "../reservationMatch";
import type { ParsedRailBooking, ParsedRailLeg } from "./types";

/**
 * A parsed booking as the review dialog shows it: every station either tied
 * to a catalogue row or explicitly unresolved, and every leg that the user
 * already logged marked as such. Nothing here writes — the user confirms each
 * leg, and the ordinary POST /rail stores it.
 */

export interface RailStationCandidate {
  /**
   * The catalogue's name when resolved — so one station is stored under one
   * spelling, whatever the ticket printed — else the printed name.
   */
  name: string;
  /** The name exactly as the document prints it. */
  printedName: string;
  stationId: number | null;
  code: string | null;
  lat: number | null;
  lon: number | null;
  country: string | null;
  timezone: string | null;
  /**
   * True only for an unambiguous catalogue match. An unresolved station keeps
   * its printed name and no position; the review asks the user to pick one —
   * a station is never silently swapped for a similar-sounding other one.
   */
  resolved: boolean;
}

export interface RailLegCandidate extends ParsedRailLeg {
  departureStation: RailStationCandidate;
  arrivalStation: RailStationCandidate;
  /** The id of a journey already logged with this reference and departure. */
  duplicateOf: string | null;
  /**
   * Present only on a reservation document's legs (forgejo#203): the logged
   * journey this seat belongs to, or why there is none to attach it to.
   */
  reservation?: ReservationMatch;
}

export interface RailImportCandidate extends Omit<ParsedRailBooking, "legs"> {
  legs: RailLegCandidate[];
}

/** Two catalogue rows further apart than this are two different stations. */
const SAME_PLACE_KM = 1;

const STATION_SELECT = {
  id: true,
  name: true,
  uic: true,
  dbId: true,
  lat: true,
  lon: true,
  country: true,
  timezone: true,
} as const;

type StationRow = {
  id: number;
  name: string;
  uic: string | null;
  dbId: string | null;
  lat: number;
  lon: number;
  country: string | null;
  timezone: string | null;
};

/**
 * General abbreviations of German timetable print, applied to the folded
 * name: "Flugh." is "Flughafen", "Bf" is "Bahnhof". Spelling rules only — no
 * station is named here.
 */
const ABBREVIATIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bflugh\b/g, "flughafen"],
  [/\bbf\b/g, "bahnhof"],
  [/\bzool gart\b/g, "zoologischer garten"],
];

/** "Muenchen" is how a mailer without umlauts writes "München". */
const transliterated = (folded: string): string =>
  folded.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");

/**
 * The names this printed name could be in the catalogue, in the order they
 * are tried. Each is an EXACT folded name; only the last step below widens.
 */
function exactVariants(printedName: string): string[] {
  const folded = foldStationName(printedName);
  const expanded = ABBREVIATIONS.reduce((acc, [re, to]) => acc.replace(re, to), folded);
  return [...new Set([folded, expanded, transliterated(expanded)])].filter(Boolean);
}

/**
 * A ticket cuts a long name to its column width: "…Flughafen T",
 * "…-Johannesk.". Only such a name — a trailing dot or a last word of one or
 * two letters — is looked up by its beginning.
 */
function truncatedPrefix(printedName: string): string | null {
  const trimmed = printedName.trim();
  const words = foldStationName(trimmed).split(" ");
  const last = words[words.length - 1] ?? "";
  const cut = trimmed.endsWith(".") || (words.length > 1 && last.length <= 2 && /\D/.test(last));
  return cut ? words.join(" ") : null;
}

/**
 * One station out of the rows a name matched, or null when they are not one
 * place. Rows carrying a rail code win over the bus stops the catalogue also
 * lists; among them the shortest name, which is the station and not one of
 * its platforms.
 */
function oneStation(rows: StationRow[]): StationRow | null {
  const coded = rows.filter((r) => r.uic !== null || r.dbId !== null);
  const pool = (coded.length > 0 ? coded : rows).sort(
    (a, b) => a.name.length - b.name.length || a.id - b.id
  );
  const [first] = pool;
  if (!first) return null;
  const scattered = pool.some(
    (r) => calculateDistance(first.lat, first.lon, r.lat, r.lon) > SAME_PLACE_KM
  );
  return scattered ? null : first;
}

/**
 * The catalogue row a printed name means — or unresolved. "Neufahrn(b
 * Freising)" and "Neufahrn (b Freising)" meet at "neufahrn b freising"; a
 * bare "Neufahrn" (two towns of that name) matches neither exactly and stays
 * unresolved; rows kilometres apart under one name are refused as ambiguous.
 * A station is never swapped for a similar-sounding other one.
 */
export async function resolveStationName(printedName: string): Promise<RailStationCandidate> {
  const unresolved: RailStationCandidate = {
    name: printedName,
    printedName,
    stationId: null,
    code: null,
    lat: null,
    lon: null,
    country: null,
    timezone: null,
    resolved: false,
  };
  const variants = exactVariants(printedName);
  if (variants.length === 0) return unresolved;

  let match: StationRow | null = null;
  for (const variant of variants) {
    const rows = await prisma.railStation.findMany({
      where: { searchName: variant },
      select: STATION_SELECT,
      orderBy: { id: "asc" },
      take: 20,
    });
    if (rows.length > 0) {
      match = oneStation(rows);
      break;
    }
  }
  const prefix = match ? null : truncatedPrefix(printedName);
  if (prefix) {
    const rows = await prisma.railStation.findMany({
      where: { searchName: { startsWith: prefix } },
      select: STATION_SELECT,
      orderBy: { id: "asc" },
      take: 20,
    });
    match = oneStation(rows);
  }
  if (!match) return unresolved;
  return {
    name: match.name,
    printedName,
    stationId: match.id,
    code: match.uic ?? null,
    lat: match.lat,
    lon: match.lon,
    country: match.country,
    // The one resolver (ADR 0002, D2): the catalogue's zone when Intl knows
    // it, the station's coordinates otherwise — never the raw column alone.
    timezone: zoneOf({ catalogueZone: match.timezone, lat: match.lat, lon: match.lon }),
    resolved: true,
  };
}

/** The widest a wall clock can sit from UTC — the search window for a duplicate. */
const WALL_CLOCK_WINDOW_MS = 14 * 60 * 60 * 1000;

/**
 * A journey the user already has for this leg: same departure wall clock at
 * the departure station, and the same booking reference — or, when the
 * document prints none, the same departure station. Compared on the stored
 * row's own station clock, so an unresolved station (no zone yet) still finds
 * the ride it was saved as.
 */
export async function findDuplicate(
  userId: string,
  leg: ParsedRailLeg,
  bookingReference: string | null
): Promise<string | null> {
  const asUtc = new Date(`${leg.departureLocal}:00Z`).getTime();
  if (Number.isNaN(asUtc)) return null;
  const rows = await prisma.railJourney.findMany({
    where: {
      userId,
      departureTime: {
        gte: new Date(asUtc - WALL_CLOCK_WINDOW_MS),
        lte: new Date(asUtc + WALL_CLOCK_WINDOW_MS),
      },
      ...(bookingReference
        ? { bookingReference: { equals: bookingReference, mode: "insensitive" as const } }
        : { depStationName: { equals: leg.depStationName, mode: "insensitive" as const } }),
    },
    select: { id: true, departureTime: true, depTimezone: true },
    take: 20,
  });
  const hit = rows.find(
    (r) => instantToWallClock(r.departureTime, r.depTimezone) === leg.departureLocal
  );
  return hit?.id ?? null;
}

export async function toRailCandidate(
  booking: ParsedRailBooking,
  userId: string | undefined
): Promise<RailImportCandidate> {
  const cache = new Map<string, Promise<RailStationCandidate>>();
  const station = (name: string): Promise<RailStationCandidate> => {
    const key = foldStationName(name);
    if (!cache.has(key)) cache.set(key, resolveStationName(name));
    return cache
      .get(key)!
      .then((s) => ({ ...s, printedName: name, name: s.resolved ? s.name : name }));
  };
  if (booking.documentKind === "reservation") {
    return reservationCandidate(booking, userId, station);
  }
  const legs: RailLegCandidate[] = [];
  for (const leg of booking.legs) {
    legs.push({
      ...leg,
      departureStation: await station(leg.depStationName),
      arrivalStation: await station(leg.arrStationName),
      duplicateOf: userId ? await findDuplicate(userId, leg, booking.bookingReference) : null,
    });
  }
  return { ...booking, legs };
}

const asReservationStation = (s: RailStationCandidate): ReservationStation => ({
  stationId: s.stationId,
  names: [s.name, s.printedName],
});

/**
 * A reservation's legs never become journeys: each is matched to the user's
 * logged rides (`reservationMatch.ts`), and the review offers the seat for the
 * one it found. Without a user there is nothing to match against.
 */
async function reservationCandidate(
  booking: ParsedRailBooking,
  userId: string | undefined,
  station: (name: string) => Promise<RailStationCandidate>
): Promise<RailImportCandidate> {
  const legs: RailLegCandidate[] = [];
  const matches: ReservationMatch[] = [];
  for (const leg of booking.legs) {
    const departureStation = await station(leg.depStationName);
    const arrivalStation = await station(leg.arrStationName);
    const journeys = userId ? await loadReservationCandidates(userId, leg) : [];
    matches.push(
      matchReservation(
        {
          ...leg,
          departure: asReservationStation(departureStation),
          arrival: asReservationStation(arrivalStation),
        },
        journeys
      )
    );
    legs.push({ ...leg, departureStation, arrivalStation, duplicateOf: null });
  }
  const settled = withoutSharedTargets(matches);
  return {
    ...booking,
    documentKind: "reservation",
    legs: legs.map((leg, i) => ({ ...leg, reservation: settled[i] })),
  };
}
