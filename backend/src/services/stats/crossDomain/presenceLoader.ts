/**
 * The dated sightings behind three cross-domain figures (forgejo#399): the
 * Schengen counter, "not seen for N years", and the time-zone shift of the
 * flights. One read of each domain, applying each domain's own counting rule —
 * `countableFlightWhere`, `classifyStay`, `classifyVisit` and the rides'
 * `countable*Where` — never a restated one.
 *
 * A PRESENCE row is a day on which a record puts the traveller in a country;
 * it is not a claim about the days between records. Stays contribute every
 * day from check-in to check-out inclusive (they are walkable only at DAY
 * precision, like the rest of the statistics); a flight contributes its
 * departure day at the departure airport's country and its arrival day at the
 * arrival airport's country, each on that airport's calendar; a ride the same
 * with its stations; a place visit its visit day in the place's country.
 * Cruises and roadtrips are not read — a port-by-port attribution is not
 * decided — and the response's notes say so.
 */
import { prisma } from "../../../db";
import { countableFlightWhere } from "../../../shared/flightCounting";
import { classifyStay } from "../../../shared/lodgingCounting";
import { resolveStayTiming } from "../../../shared/lodgingTiming";
import { classifyVisit } from "../../../shared/placeCounting";
import { countableRailWhere } from "../../../shared/railCounting";
import { countableBusWhere } from "../../../shared/busCounting";
import { countableFerryWhere } from "../../../shared/ferryCounting";
import { localDay } from "../../../shared/time/instant";
import type { DomainKey } from "../../../shared/domains";
import type { Sighting } from "../../../utils/stats/crossDomain/lastVisit";
import type { PresenceDay } from "../../../utils/stats/crossDomain/schengen";
import type { TimeShiftFlight } from "../../../utils/stats/crossDomain/timeShift";
import { getCachedAirports } from "../../airportCache";
import { flightLocalDays } from "../travelAccountData";
import { tzMapFromAirports } from "../departureClock";

export interface PresenceData {
  presence: PresenceDay[];
  sightings: Sighting[];
  shiftFlights: TimeShiftFlight[];
}

const COUNTRY = /^[A-Za-z]{2}$/;
const DAY_MS = 86_400_000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const alpha2 = (raw: string | null | undefined): string | null =>
  raw && COUNTRY.test(raw) ? raw.toUpperCase() : null;

/** Every day from `from` to `to` inclusive, on the UTC date the wall clock was pinned to. */
function inclusiveDays(from: Date, to: Date): string[] {
  const days: string[] = [];
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (
    let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    t <= last;
    t += DAY_MS
  ) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

interface Rides {
  departureTime: Date;
  arrivalTime: Date | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  depCountry: string | null;
  arrCountry: string | null;
}

function ridePresence(ride: Rides): PresenceDay[] {
  const out: PresenceDay[] = [];
  const dep = alpha2(ride.depCountry);
  const arr = alpha2(ride.arrCountry);
  if (dep)
    out.push({ date: localDay(ride.departureTime, ride.depTimezone ?? "UTC"), country: dep });
  if (arr && ride.arrivalTime) {
    out.push({ date: localDay(ride.arrivalTime, ride.arrTimezone ?? "UTC"), country: arr });
  }
  return out;
}

const RIDE_SELECT = {
  departureTime: true,
  arrivalTime: true,
  depTimezone: true,
  arrTimezone: true,
  depCountry: true,
  arrCountry: true,
} as const;

export async function loadPresence(
  userId: string,
  visible: ReadonlySet<DomainKey>,
  now: Date,
  today: string
): Promise<PresenceData> {
  const presence: PresenceDay[] = [];
  const sightings: Sighting[] = [];
  const shiftFlights: TimeShiftFlight[] = [];

  if (visible.has("flight")) {
    const flights = await prisma.flight.findMany({
      where: { userId, ...countableFlightWhere() },
      select: {
        id: true,
        departureTime: true,
        arrivalTime: true,
        depIata: true,
        depIcao: true,
        arrIata: true,
        arrIcao: true,
        depName: true,
        arrName: true,
        depTimeSemantics: true,
        arrTimeSemantics: true,
        depTimezone: true,
        arrTimezone: true,
        depPrecision: true,
        arrPrecision: true,
      },
    });
    const codes = new Set<string>();
    for (const f of flights) {
      for (const c of [f.depIata, f.depIcao, f.arrIata, f.arrIcao]) if (c) codes.add(c);
    }
    const airports = await getCachedAirports([...codes]);
    const tzMap = tzMapFromAirports(airports);
    const reliable = (semantics: string, precision: string | null): boolean =>
      semantics === "UTC" && (precision === null || precision === "minute");
    for (const f of flights) {
      const depCode = f.depIata ?? f.depIcao;
      const arrCode = f.arrIata ?? f.arrIcao;
      const days = flightLocalDays(f, tzMap);
      const ends: Array<[string | null, string | null, string | null]> = [
        [depCode, days.depLocalDay ? iso(days.depLocalDay) : null, f.depName],
        [arrCode, days.arrLocalDay ? iso(days.arrLocalDay) : null, f.arrName],
      ];
      for (const [code, day, name] of ends) {
        if (!code) continue;
        sightings.push({ kind: "airport", key: code, label: name ?? code, date: day });
        const country = alpha2(airports.get(code)?.country);
        if (country && day) {
          presence.push({ date: day, country });
          sightings.push({ kind: "country", key: country, label: country, date: day });
        }
      }
      shiftFlights.push({
        id: f.id,
        departureTime: f.departureTime,
        arrivalTime: f.arrivalTime,
        depZone: days.depTimezone,
        arrZone: f.arrTimezone || (arrCode ? (tzMap.get(arrCode) ?? null) : null),
        instantsReal:
          reliable(f.depTimeSemantics, f.depPrecision) &&
          reliable(f.arrTimeSemantics, f.arrPrecision),
        depLabel: depCode,
        arrLabel: arrCode,
      });
    }
  }

  if (visible.has("lodging")) {
    const stays = await prisma.lodgingStay.findMany({
      where: { userId, lodging: { visited: true } },
      select: {
        checkIn: true,
        checkOut: true,
        status: true,
        datePrecision: true,
        nights: true,
        lodging: { select: { isoCountryCode: true } },
      },
    });
    for (const stay of stays) {
      const country = alpha2(stay.lodging.isoCountryCode);
      if (!country || classifyStay(stay, now) !== "visited") continue;
      if (!resolveStayTiming(stay).walkable || !stay.checkIn || !stay.checkOut) continue;
      for (const date of inclusiveDays(stay.checkIn, stay.checkOut)) {
        if (date > today) break;
        presence.push({ date, country });
        sightings.push({ kind: "country", key: country, label: country, date });
      }
    }
  }

  if (visible.has("poi")) {
    const visits = await prisma.placeVisit.findMany({
      where: { userId, place: { visited: true } },
      select: {
        visitedAt: true,
        visitedAtUtc: true,
        place: { select: { id: true, name: true, isoCountryCode: true } },
      },
    });
    for (const v of visits) {
      if (classifyVisit(v, now) !== "visited" || !v.visitedAt) continue;
      // A visit is a wall clock pinned to UTC midnight: its UTC date is the local date.
      const date = iso(v.visitedAt);
      sightings.push({ kind: "place", key: v.place.id, label: v.place.name, date });
      const country = alpha2(v.place.isoCountryCode);
      if (country) {
        presence.push({ date, country });
        sightings.push({ kind: "country", key: country, label: country, date });
      }
    }
  }

  const rideRows: Array<[DomainKey, Rides[]]> = [];
  if (visible.has("rail")) {
    rideRows.push([
      "rail",
      await prisma.railJourney.findMany({
        where: { userId, ...countableRailWhere() },
        select: RIDE_SELECT,
      }),
    ]);
  }
  if (visible.has("bus")) {
    rideRows.push([
      "bus",
      await prisma.busJourney.findMany({
        where: { userId, ...countableBusWhere() },
        select: RIDE_SELECT,
      }),
    ]);
  }
  if (visible.has("ferry")) {
    rideRows.push([
      "ferry",
      await prisma.ferryJourney.findMany({
        where: { userId, ...countableFerryWhere() },
        select: RIDE_SELECT,
      }),
    ]);
  }
  for (const [, rides] of rideRows) {
    for (const ride of rides) {
      for (const day of ridePresence(ride)) {
        if (day.date > today) continue;
        presence.push(day);
        sightings.push({ kind: "country", key: day.country, label: day.country, date: day.date });
      }
    }
  }

  return { presence, sightings, shiftFlights };
}
