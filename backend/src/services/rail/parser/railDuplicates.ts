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

const MINUTE_MS = 60 * 1000;
const QUARTER_HOUR_MS = 15 * MINUTE_MS;
/** UTC offsets in use run from −12:00 to +14:00, all in whole quarter hours. */
const OFFSET_QUARTERS = Array.from({ length: (12 + 14) * 4 + 1 }, (_, i) => i - 12 * 4);

/**
 * Every instant at which a ride could show `departureLocal` on its own station
 * clock: one minute per UTC offset in use. The lookup is narrowed to these in
 * the database, so no limit is needed and none can cut off the ride sought —
 * a 28-hour window capped at 20 rows did, for a user with more rides that day.
 */
function departureMinutes(departureLocal: string): { departureTime: { gte: Date; lt: Date } }[] {
  const asUtc = new Date(`${departureLocal}:00Z`).getTime();
  if (Number.isNaN(asUtc)) return [];
  return OFFSET_QUARTERS.map((q) => {
    const at = asUtc - q * QUARTER_HOUR_MS;
    return { departureTime: { gte: new Date(at), lt: new Date(at + MINUTE_MS) } };
  });
}

/**
 * Every name a stop may have been saved under: the catalogue's, the resolved
 * stop's printed one and the leg's own. The leg's name is passed separately
 * because it is the one spelling that cannot be lost on the way through a
 * resolver — an earlier import of an unresolved stop saved exactly that.
 */
const spellings = (s: DuplicateStation, legName: string): string[] => [
  ...new Set([s.name, s.printedName, legName].filter((n) => n.trim() !== "")),
];

const nameIsOneOf = (s: DuplicateStation, legName: string) =>
  spellings(s, legName).map((name) => ({
    depStationName: { equals: name, mode: "insensitive" as const },
  }));

interface StoredEnd {
  id: number | null;
  code: string | null;
  name: string;
}

/** The stored end is this stop: its catalogue row, its code, or one of its names. */
function isStation(stored: StoredEnd, s: DuplicateStation, legName: string): boolean {
  if (s.stationId !== null && stored.id === s.stationId) return true;
  if (s.code && stored.code === s.code) return true;
  const names = new Set(spellings(s, legName).map(foldStationName));
  return names.has(foldStationName(stored.name));
}

const foldTrainPart = (v: string | null): string | null => {
  const folded = (v ?? "").toLowerCase().replace(/\s+/g, "");
  return folded === "" ? null : folded;
};

/**
 * Whether two trains are one: "same" when the numbers agree (and the
 * categories, where both name one), "other" when they differ, "unknown" when
 * either side names no number — then nothing tells them apart.
 */
function trainIdentity(
  stored: { trainCategory: string | null; trainNumber: string | null },
  leg: ParsedRailLeg
): "same" | "other" | "unknown" {
  const [a, b] = [foldTrainPart(stored.trainNumber), foldTrainPart(leg.trainNumber)];
  if (a === null || b === null) return "unknown";
  if (a !== b) return "other";
  const [ca, cb] = [foldTrainPart(stored.trainCategory), foldTrainPart(leg.trainCategory)];
  return ca !== null && cb !== null && ca !== cb ? "other" : "same";
}

/**
 * A journey the user already has for this leg, at the same departure wall
 * clock — compared on the stored row's own station clock, so an unresolved
 * station (no zone yet) still finds the ride it was saved as.
 *
 * The same booking reference settles it. Without one — or when no ride
 * carries it, as when the ride was saved from a reference-free bahn.de
 * connection before the ticket came — the ride must leave the same station
 * (catalogue row, code, or a name) for the same arrival station on the same
 * train. Several trains leave one station in the same minute, so a missing
 * train number makes it a POSSIBLE duplicate only, and a different number or
 * destination a ride of its own.
 */
export async function findDuplicate(
  userId: string,
  leg: ParsedRailLeg,
  bookingReference: string | null,
  departure: DuplicateStation,
  arrival: DuplicateStation
): Promise<DuplicateMatch> {
  const minutes = departureMinutes(leg.departureLocal);
  if (minutes.length === 0) return NO_DUPLICATE;
  const matchers = [
    ...(bookingReference
      ? [{ bookingReference: { equals: bookingReference, mode: "insensitive" as const } }]
      : []),
    ...(departure.stationId !== null ? [{ depStationId: departure.stationId }] : []),
    ...(departure.code ? [{ depStationCode: departure.code }] : []),
    ...nameIsOneOf(departure, leg.depStationName),
  ];
  const rows = await prisma.railJourney.findMany({
    where: { userId, AND: [{ OR: minutes }, { OR: matchers }] },
    select: {
      id: true,
      departureTime: true,
      depTimezone: true,
      bookingReference: true,
      depStationId: true,
      depStationCode: true,
      depStationName: true,
      arrStationId: true,
      arrStationCode: true,
      arrStationName: true,
      trainCategory: true,
      trainNumber: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const atMinute = rows.filter(
    (r) => instantToWallClock(r.departureTime, r.depTimezone) === leg.departureLocal
  );
  const reference = bookingReference?.toLowerCase();
  const booked = reference
    ? atMinute.find((r) => r.bookingReference?.toLowerCase() === reference)
    : undefined;
  if (booked) return { duplicateOf: booked.id, possibleDuplicateOf: null };
  const sameRoute = atMinute.filter(
    (r) =>
      isStation(
        { id: r.depStationId, code: r.depStationCode, name: r.depStationName },
        departure,
        leg.depStationName
      ) &&
      isStation(
        { id: r.arrStationId, code: r.arrStationCode, name: r.arrStationName },
        arrival,
        leg.arrStationName
      )
  );
  const certain = sameRoute.find((r) => trainIdentity(r, leg) === "same");
  if (certain) return { duplicateOf: certain.id, possibleDuplicateOf: null };
  const possible = sameRoute.find((r) => trainIdentity(r, leg) === "unknown");
  return { duplicateOf: null, possibleDuplicateOf: possible?.id ?? null };
}

/** "Bus 100", "bus  100" — the line as the bus import stores it (`lineName`). */
const foldLine = (line: string | null): string | null => {
  const folded = (line ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return folded === "" ? null : folded.slice(0, 40);
};

/**
 * The leg's line, or null when the document names none. A category alone
 * ("Bus", "SEV") is no line: every unnumbered bus would share it, and two of
 * them leaving one stop in the same minute would be taken for one ride.
 */
const lineOf = (leg: ParsedRailLeg): string | null =>
  leg.trainNumber?.trim() ? foldLine(`${leg.trainCategory ?? ""} ${leg.trainNumber}`) : null;

/**
 * A stored ride's line, or null when it names none. The import saves an
 * unnumbered bus as its bare category, so a stored "Bus" is as silent about
 * the line as an empty field.
 */
const storedLineOf = (lineName: string | null, leg: ParsedRailLeg): string | null => {
  const line = foldLine(lineName);
  return line !== null && line === foldLine(leg.trainCategory) ? null : line;
};

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
  const minutes = departureMinutes(leg.departureLocal);
  if (minutes.length === 0) return NO_DUPLICATE;
  const rows = await prisma.busJourney.findMany({
    where: { userId, AND: [{ OR: minutes }, { OR: nameIsOneOf(departure, leg.depStationName) }] },
    select: {
      id: true,
      departureTime: true,
      depTimezone: true,
      arrStationName: true,
      lineName: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const arrivals = new Set(spellings(arrival, leg.arrStationName).map(foldStationName));
  const line = lineOf(leg);
  const sameRide = rows.filter(
    (r) =>
      instantToWallClock(r.departureTime, r.depTimezone) === leg.departureLocal &&
      arrivals.has(foldStationName(r.arrStationName))
  );
  const certain = sameRide.find((r) => line !== null && storedLineOf(r.lineName, leg) === line);
  if (certain) return { duplicateOf: certain.id, possibleDuplicateOf: null };
  const possible = sameRide.find((r) => line === null || storedLineOf(r.lineName, leg) === null);
  return { duplicateOf: null, possibleDuplicateOf: possible?.id ?? null };
}
