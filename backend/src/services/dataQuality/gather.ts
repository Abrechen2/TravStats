import { prisma } from "../../db";
import { lodgingEvidence } from "../../shared/countryEvidence";
import { classifyPlace, classifyVisit } from "../../shared/placeCounting";
import { getCachedAirports } from "../airportCache";
import type { AddressBearingRecord } from "./checks/addressCountryMismatch";
import type { CountryTouch } from "./checks/undatedCountryEvidence";
import type { LodgingWithStays } from "./checks/stayDatesReversed";

/**
 * Everything the checks need from one account, read once.
 *
 * The checks are pure functions over plain data; this is the only file in the
 * feature that talks to Postgres. That split is what lets each rule be tested
 * against a hand-written case rather than a fixture database, and it keeps the
 * number of round trips per run visible in one place.
 *
 * Nothing here decides anything. Where a decision is needed — does this lodging
 * count, and with what date; does this place count — it is delegated to
 * `shared/countryEvidence.ts` and `shared/placeCounting.ts`, which own those
 * questions for the whole server.
 */

/** The flown statuses, matching what the passport counts. */
const FLOWN = new Set(["flown", "historical"]);

export interface AccountSnapshot {
  /** Lodgings and places, for the address check. */
  addressRecords: AddressBearingRecord[];
  /** Lodgings with their stays, for the reversed-dates check. */
  lodgingStays: LodgingWithStays[];
  /** Every claim on a country this account holds, for the undated check. */
  countryTouches: CountryTouch[];
}

/**
 * The earliest visit that has actually happened, or null.
 *
 * `classifyVisit` is what decides "happened": a future-dated visit is a plan,
 * and an UNDATED visit already counts as visited — so a place with only undated
 * visits is undated evidence, exactly like a house with no stay.
 */
function earliestCompletedVisit(
  visits: readonly { visitedAt: Date | null }[],
  now: Date
): Date | null {
  let earliest: Date | null = null;
  for (const visit of visits) {
    if (visit.visitedAt === null) continue;
    if (classifyVisit(visit, now) !== "visited") continue;
    if (earliest === null || visit.visitedAt.getTime() < earliest.getTime()) {
      earliest = visit.visitedAt;
    }
  }
  return earliest;
}

export async function loadAccountSnapshot(
  userId: string,
  now: Date = new Date()
): Promise<AccountSnapshot> {
  const [lodgings, places, flights, portCalls] = await Promise.all([
    // Ordered by id, here and for places below, because a finding's `details`
    // carries a LIST of records and an unordered read would reshuffle it
    // between runs — which the reconciler would read as a change and write
    // again, every run, for ever. Postgres promises no order without one.
    prisma.lodging.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        address: true,
        country: true,
        isoCountryCode: true,
        // `status` because `lodgingEvidence` reads it: a house whose only stay
        // was CANCELLED proves nothing, and without the column it read as a
        // house with no stay — which counts as a night.
        stays: { select: { id: true, status: true, checkIn: true, checkOut: true } },
      },
    }),
    prisma.place.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        address: true,
        country: true,
        isoCountryCode: true,
        visited: true,
        visits: { select: { visitedAt: true } },
      },
    }),
    // Only flights that have a departure time: an undated flight is not
    // evidence the passport counts either, so counting it here would flag a
    // country nothing else lists.
    prisma.flight.findMany({
      where: { userId, status: { in: [...FLOWN] }, departureTime: { not: null } },
      select: { depIata: true, arrIata: true, departureTime: true, arrivalTime: true },
    }),
    // Cruise stops reach the user through the cruise, which is why this is not
    // a `where: { userId }`. Dated port calls only — see the check's header for
    // the limit that buys.
    prisma.cruiseStop.findMany({
      where: { cruise: { userId }, date: { not: null }, portId: { not: null } },
      select: { date: true, port: { select: { country: true, unlocode: true } } },
    }),
  ]);

  const addressRecords: AddressBearingRecord[] = [
    ...lodgings.map((lodging) => ({
      entityType: "lodging" as const,
      id: lodging.id,
      address: lodging.address,
      country: lodging.country,
      isoCountryCode: lodging.isoCountryCode,
    })),
    ...places.map((place) => ({
      entityType: "place" as const,
      id: place.id,
      address: place.address,
      country: place.country,
      isoCountryCode: place.isoCountryCode,
    })),
  ];

  const countryTouches: CountryTouch[] = [];

  for (const lodging of lodgings) {
    const evidence = lodgingEvidence(lodging.stays, now);
    // Null means every stay is still in the future — a booking, not a visit.
    if (!evidence) continue;
    countryTouches.push({
      country: lodging.isoCountryCode ?? lodging.country,
      at: evidence.at,
      record:
        evidence.at === null
          ? { entityType: "lodging", entityId: lodging.id, label: lodging.name }
          : null,
    });
  }

  for (const place of places) {
    if (classifyPlace({ visited: place.visited }) !== "visited") continue;
    const at = earliestCompletedVisit(place.visits, now);
    countryTouches.push({
      country: place.isoCountryCode ?? place.country,
      at,
      record: at === null ? { entityType: "place", entityId: place.id, label: place.name } : null,
    });
  }

  const iataCodes = [
    ...new Set(
      flights.flatMap((flight) => [flight.depIata, flight.arrIata]).filter((c): c is string => !!c)
    ),
  ];
  const airports = iataCodes.length > 0 ? await getCachedAirports(iataCodes) : new Map();

  for (const flight of flights) {
    for (const [code, at] of [
      [flight.depIata, flight.departureTime],
      [flight.arrIata, flight.arrivalTime ?? flight.departureTime],
    ] as const) {
      if (!code || !at) continue;
      const country = airports.get(code.toUpperCase())?.country ?? null;
      if (!country) continue;
      countryTouches.push({ country, at, record: null });
    }
  }

  for (const stop of portCalls) {
    // The UN/LOCODE's first two letters ARE the ISO country code, and the
    // catalogue's free-text `country` is not always filled — so it is the
    // fallback, not the other way round.
    const country = stop.port?.unlocode?.slice(0, 2) ?? stop.port?.country ?? null;
    if (!country || !stop.date) continue;
    countryTouches.push({ country, at: stop.date, record: null });
  }

  return {
    addressRecords,
    lodgingStays: lodgings.map((lodging) => ({ id: lodging.id, stays: lodging.stays })),
    countryTouches,
  };
}
