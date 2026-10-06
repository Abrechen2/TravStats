import { prisma } from "../../db";
import { foldStationName } from "./railStations";
import { instantToWallClock } from "./railJourneyWrite";
import type { ParsedRailLeg } from "./parser/types";

/**
 * Which logged journey a seat reservation belongs to (forgejo#203). A
 * reservation booked after the ticket names a train, a day, two stations and a
 * seat; the seat goes onto the ONE journey those describe, and nowhere when
 * they describe none or several. Nothing here writes — the review shows the
 * outcome and the user's confirmation PATCHes the journey through the
 * ordinary rail update (ownership checked there).
 *
 * The rule, every part of it required:
 *
 *  1. Same train — the numbers equal; the categories equal when both sides
 *     name one (DB does not run an ICE 615 and an IC 615 on one day, and a
 *     logged ride often carries the number without the category).
 *  2. Same day on the departure station's clock — the journey's local
 *     departure day is the reservation's.
 *  3. Stations consistent — both ends the journey's own, or a SUB-SECTION: an
 *     end that is not the journey's must lie strictly inside the journey's
 *     time span (wall clocks compared as printed; DB's own trains). An end
 *     whose time is unknown cannot be proved inside and does not match. A
 *     reservation running the other way (its departure is the journey's
 *     arrival) is not consistent.
 *
 * Limits, said rather than hidden: a sub-section that starts after midnight on
 * a night train has a different local day from the journey and finds none —
 * the review then says "no journey" and nothing is written.
 */

/** A journey a reservation may attach to, as the review shows it. */
export interface ReservationTarget {
  id: string;
  trainCategory: string | null;
  trainNumber: string | null;
  depStationName: string;
  arrStationName: string;
  /** `YYYY-MM-DDTHH:mm` on the departure station's clock. */
  departureLocal: string;
  arrivalLocal: string | null;
  coach: string | null;
  seat: string | null;
}

export type ReservationMatch =
  /** One journey, and its coach/seat are empty or agree: fill them. */
  | { kind: "attach"; target: ReservationTarget; subSection: boolean }
  /** One journey that already holds a DIFFERENT coach or seat: the user confirms. */
  | { kind: "change"; target: ReservationTarget; subSection: boolean }
  /** One journey that already holds exactly this seat: nothing to do. */
  | { kind: "alreadySet"; target: ReservationTarget; subSection: boolean }
  /** Several journeys fit; which one is not guessed. */
  | { kind: "several"; targets: ReservationTarget[] }
  /** Another reservation section of this document names the same journey. */
  | { kind: "sameJourneyTwice"; target: ReservationTarget }
  | { kind: "none"; reason: "noTrain" | "noSeat" | "noJourney" };

/** A station as the reservation names it: the catalogue id when resolved, and its names. */
export interface ReservationStation {
  stationId: number | null;
  names: readonly string[];
}

/** A logged journey with its clocks already on its stations' wall. */
export interface JourneyForMatch extends ReservationTarget {
  depStationId: number | null;
  arrStationId: number | null;
}

export interface ReservationLeg extends Pick<
  ParsedRailLeg,
  "trainCategory" | "trainNumber" | "departureLocal" | "arrivalLocal" | "coach" | "seat"
> {
  departure: ReservationStation;
  arrival: ReservationStation;
}

const norm = (value: string | null): string | null => {
  const v = value?.trim().replace(/\s+/g, " ").toUpperCase() ?? "";
  return v === "" ? null : v;
};

/** "0615" and "615" are one train number. */
const trainNumberOf = (value: string | null): string | null =>
  norm(value)?.replace(/^0+(?=\d)/, "") ?? null;

function sameTrain(leg: ReservationLeg, j: JourneyForMatch): boolean {
  const number = trainNumberOf(leg.trainNumber);
  if (number === null || number !== trainNumberOf(j.trainNumber)) return false;
  const [a, b] = [norm(leg.trainCategory), norm(j.trainCategory)];
  return a === null || b === null || a === b;
}

function sameStation(s: ReservationStation, stationId: number | null, name: string): boolean {
  if (s.stationId !== null && stationId !== null) return s.stationId === stationId;
  const folded = foldStationName(name);
  return s.names.some((n) => foldStationName(n) === folded);
}

const inside = (t: string | null, from: string, to: string | null): boolean =>
  t !== null && to !== null && t > from && t < to;

/** Whether the reservation's stretch is this journey, or a stretch of it; null when neither. */
function sectionOf(leg: ReservationLeg, j: JourneyForMatch): { subSection: boolean } | null {
  const sameDep = sameStation(leg.departure, j.depStationId, j.depStationName);
  const sameArr = sameStation(leg.arrival, j.arrStationId, j.arrStationName);
  const reversed =
    sameStation(leg.departure, j.arrStationId, j.arrStationName) ||
    sameStation(leg.arrival, j.depStationId, j.depStationName);
  if (reversed && !(sameDep && sameArr)) return null;
  if (sameDep && sameArr) return { subSection: false };
  const depOk = sameDep || inside(leg.departureLocal, j.departureLocal, j.arrivalLocal);
  const arrOk = sameArr || inside(leg.arrivalLocal, j.departureLocal, j.arrivalLocal);
  return depOk && arrOk ? { subSection: true } : null;
}

/** A value the reservation prints that the journey holds differently. */
const differs = (journey: string | null, reservation: string | null): boolean =>
  norm(journey) !== null && norm(reservation) !== null && norm(journey) !== norm(reservation);

const target = (j: JourneyForMatch): ReservationTarget => ({
  id: j.id,
  trainCategory: j.trainCategory,
  trainNumber: j.trainNumber,
  depStationName: j.depStationName,
  arrStationName: j.arrStationName,
  departureLocal: j.departureLocal,
  arrivalLocal: j.arrivalLocal,
  coach: j.coach,
  seat: j.seat,
});

/** The pure rule: one reservation leg against the user's candidate journeys. */
export function matchReservation(
  leg: ReservationLeg,
  journeys: readonly JourneyForMatch[]
): ReservationMatch {
  if (trainNumberOf(leg.trainNumber) === null) return { kind: "none", reason: "noTrain" };
  if (norm(leg.coach) === null && norm(leg.seat) === null) {
    return { kind: "none", reason: "noSeat" };
  }
  const day = leg.departureLocal.slice(0, 10);
  const hits = journeys
    .filter((j) => sameTrain(leg, j) && j.departureLocal.slice(0, 10) === day)
    .map((j) => ({ j, section: sectionOf(leg, j) }))
    .filter((h): h is { j: JourneyForMatch; section: { subSection: boolean } } => !!h.section);
  if (hits.length === 0) return { kind: "none", reason: "noJourney" };
  if (hits.length > 1) return { kind: "several", targets: hits.map((h) => target(h.j)) };

  const [{ j, section }] = hits;
  const found = { target: target(j), subSection: section.subSection };
  if (differs(j.coach, leg.coach) || differs(j.seat, leg.seat)) return { kind: "change", ...found };
  const unchanged =
    (norm(leg.coach) === null || norm(leg.coach) === norm(j.coach)) &&
    (norm(leg.seat) === null || norm(leg.seat) === norm(j.seat));
  return unchanged ? { kind: "alreadySet", ...found } : { kind: "attach", ...found };
}

/**
 * Two sections of one document that land on the same journey (a seat change
 * mid-train) cannot both be written to its one coach/seat pair — which of them
 * the user means is not guessed, so both say so.
 */
export function withoutSharedTargets(matches: readonly ReservationMatch[]): ReservationMatch[] {
  const idOf = (m: ReservationMatch): string | null =>
    m.kind === "attach" || m.kind === "change" || m.kind === "alreadySet" ? m.target.id : null;
  const counts = new Map<string, number>();
  for (const m of matches) {
    const id = idOf(m);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return matches.map((m) => {
    const id = idOf(m);
    return id && (counts.get(id) ?? 0) > 1 && "target" in m
      ? { kind: "sameJourneyTwice", target: m.target }
      : m;
  });
}

/** The widest a wall clock can sit from UTC, either way. */
const WALL_CLOCK_WINDOW_MS = 14 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 50;

/**
 * The user's journeys on this train number around this day, with their clocks
 * on their own stations' walls. The SQL bound is wide (any zone could put the
 * day there); the day itself is decided by `matchReservation` on the wall clock.
 */
export async function loadReservationCandidates(
  userId: string,
  leg: Pick<ParsedRailLeg, "trainNumber" | "departureLocal">
): Promise<JourneyForMatch[]> {
  const number = trainNumberOf(leg.trainNumber);
  const dayStart = new Date(`${leg.departureLocal.slice(0, 10)}T00:00:00Z`).getTime();
  if (number === null || Number.isNaN(dayStart)) return [];
  const rows = await prisma.railJourney.findMany({
    where: {
      userId,
      trainNumber: { in: [number, leg.trainNumber!.trim()] },
      departureTime: {
        gte: new Date(dayStart - WALL_CLOCK_WINDOW_MS),
        lt: new Date(dayStart + DAY_MS + WALL_CLOCK_WINDOW_MS),
      },
    },
    select: {
      id: true,
      trainCategory: true,
      trainNumber: true,
      depStationName: true,
      arrStationName: true,
      depStationId: true,
      arrStationId: true,
      departureTime: true,
      arrivalTime: true,
      depTimezone: true,
      arrTimezone: true,
      coach: true,
      seat: true,
    },
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    take: MAX_CANDIDATES,
  });
  return rows.map(({ departureTime, arrivalTime, depTimezone, arrTimezone, ...row }) => ({
    ...row,
    departureLocal: instantToWallClock(departureTime, depTimezone),
    arrivalLocal: arrivalTime ? instantToWallClock(arrivalTime, arrTimezone) : null,
  }));
}
