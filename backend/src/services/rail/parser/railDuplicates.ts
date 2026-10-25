import { prisma } from "../../../db";
import { foldStationName } from "../railStations";
import { instantToWallClock } from "../railJourneyWrite";
import type { ParsedRailLeg } from "./types";

/**
 * Whether a parsed leg is a ride the user already logged. An import stores a
 * resolved station under the CATALOGUE's name ("Teststadt Hauptbahnhof"), not
 * the one the document printed ("Teststadt Hbf (tief)"), so a repeat import is
 * matched on the station itself — its catalogue row, its code — and on both
 * spellings. Matching on the printed name alone missed every resolved stop of a
 * bahn.de connection and offered the ride a second time (Codex, pre-RC review).
 */

/** What duplicate detection needs of a resolved station (`RailStationCandidate`). */
export interface DuplicateStation {
  name: string;
  printedName: string;
  stationId: number | null;
  code: string | null;
}

/**
 * `duplicateOf`: certainly logged — the review leaves the leg unticked.
 * `possibleDuplicateOf`: a ride that may be this one, but nothing tells them
 * apart either way — the review says so and leaves the choice to the user.
 */
export interface DuplicateMatch {
  duplicateOf: string | null;
  possibleDuplicateOf: string | null;
}

export const NO_DUPLICATE: DuplicateMatch = { duplicateOf: null, possibleDuplicateOf: null };

/** The widest a wall clock can sit from UTC — the search window for a duplicate. */
const WALL_CLOCK_WINDOW_MS = 14 * 60 * 60 * 1000;

function departureWindow(departureLocal: string): { gte: Date; lte: Date } | null {
  const asUtc = new Date(`${departureLocal}:00Z`).getTime();
  if (Number.isNaN(asUtc)) return null;
  return {
    gte: new Date(asUtc - WALL_CLOCK_WINDOW_MS),
    lte: new Date(asUtc + WALL_CLOCK_WINDOW_MS),
  };
}

const spellings = (s: DuplicateStation): string[] => [...new Set([s.name, s.printedName])];

const nameIsOneOf = (s: DuplicateStation) =>
  spellings(s).map((name) => ({
    depStationName: { equals: name, mode: "insensitive" as const },
  }));

/**
 * A journey the user already has for this leg: same departure wall clock at
 * the departure station, and the same booking reference — or, when the
 * document prints none, the same departure station: its catalogue row, its
 * code, the catalogue's name or the printed one. Compared on the stored row's
 * own station clock, so an unresolved station (no zone yet) still finds the
 * ride it was saved as.
 */
export async function findDuplicate(
  userId: string,
  leg: ParsedRailLeg,
  bookingReference: string | null,
  departure: DuplicateStation
): Promise<string | null> {
  const window = departureWindow(leg.departureLocal);
  if (!window) return null;
  const sameStation = [
    ...(departure.stationId !== null ? [{ depStationId: departure.stationId }] : []),
    ...(departure.code ? [{ depStationCode: departure.code }] : []),
    ...nameIsOneOf(departure),
  ];
  const rows = await prisma.railJourney.findMany({
    where: {
      userId,
      departureTime: window,
      ...(bookingReference
        ? { bookingReference: { equals: bookingReference, mode: "insensitive" as const } }
        : { OR: sameStation }),
    },
    select: { id: true, departureTime: true, depTimezone: true },
    take: 20,
  });
  const hit = rows.find(
    (r) => instantToWallClock(r.departureTime, r.depTimezone) === leg.departureLocal
  );
  return hit?.id ?? null;
}

/** "Bus 100", "bus  100" — the line as the bus import stores it (`lineName`). */
const foldLine = (line: string | null): string | null => {
  const folded = (line ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return folded === "" ? null : folded.slice(0, 40);
};

const lineOf = (leg: ParsedRailLeg): string | null =>
  foldLine([leg.trainCategory, leg.trainNumber].filter(Boolean).join(" "));

/**
 * A bus ride the user already has for a bus leg of a bahn.de connection. A bus
 * leg is saved as a bus ride, so a repeat import is looked for there — never
 * among the trains. Several buses leave one stop in the same minute, so a ride
 * counts as this leg only when it also goes to the same stop on the same line.
 * Where a line is missing on either side nothing tells the two apart: the ride
 * is offered as a POSSIBLE duplicate, which the review shows without unticking.
 */
export async function findBusDuplicate(
  userId: string,
  leg: ParsedRailLeg,
  departure: DuplicateStation,
  arrival: DuplicateStation
): Promise<DuplicateMatch> {
  const window = departureWindow(leg.departureLocal);
  if (!window) return NO_DUPLICATE;
  const rows = await prisma.busJourney.findMany({
    where: { userId, departureTime: window, OR: nameIsOneOf(departure) },
    select: {
      id: true,
      departureTime: true,
      depTimezone: true,
      arrStationName: true,
      lineName: true,
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const arrivals = new Set(spellings(arrival).map(foldStationName));
  const line = lineOf(leg);
  const sameRide = rows.filter(
    (r) =>
      instantToWallClock(r.departureTime, r.depTimezone) === leg.departureLocal &&
      arrivals.has(foldStationName(r.arrStationName))
  );
  const certain = sameRide.find((r) => line !== null && foldLine(r.lineName) === line);
  if (certain) return { duplicateOf: certain.id, possibleDuplicateOf: null };
  const possible = sameRide.find((r) => line === null || foldLine(r.lineName) === null);
  return { duplicateOf: null, possibleDuplicateOf: possible?.id ?? null };
}
