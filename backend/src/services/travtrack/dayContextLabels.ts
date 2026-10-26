import { prisma } from "../../db";
import type { DomainKey } from "../../shared/domains";
import type { TimeValue } from "../../shared/time/wire";
import { getAirportTimezone } from "../../utils/timezone";
import { flightTimes } from "../flights/timesDto";
import type { Span } from "./readSafe";

/**
 * How each domain's record reads on a day of the TravTrack history (TravTrack
 * plan E10): its label, the page it opens, its own pin on the map and — where
 * the record knows it better than its entry window — the span it really took.
 * Read from the record's own table by id, never from points.
 *
 * `Record<DomainKey, …>`: a new domain is described before it ships. A window
 * of a domain without a describer (one only an adapter knows) is still shown,
 * unnamed and unlinked — `dayContext.ts` names no domain.
 */

export type Pin = { lat: number; lon: number };

export type Described = {
  label: string;
  /** The web path of the record, or null when it has no page. */
  href: string | null;
  /** The record's own position, or null; `dayContext.ts` drops one inside a zone. */
  pin: Pin | null;
  /** The record's real span, when its entry window is only a bound of it (a flight). */
  span?: Span;
};

export type Describer = (userId: string, ids: readonly string[]) => Promise<Map<string, Described>>;

const pinOf = (lat: number | null | undefined, lon: number | null | undefined): Pin | null =>
  typeof lat === "number" && typeof lon === "number" ? { lat, lon } : null;

const joined = (...parts: Array<string | null | undefined>) =>
  parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join(" ")
    .trim();

const route = (from: string | null | undefined, to: string | null | undefined) =>
  `${from ?? "?"}–${to ?? "?"}`;

/** An instant a clock can be read off: a real minute, never a day placeholder. */
const instantOf = (value: TimeValue | null): number | null =>
  value && value.precision === "minute" ? Date.parse(value.utc) : null;

const byId = <T extends { id: string }>(rows: T[], describe: (row: T) => Described) =>
  new Map(rows.map((row) => [row.id, describe(row)]));

const describeFlights: Describer = async (userId, ids) => {
  const flights = await prisma.flight.findMany({
    where: { userId, id: { in: [...ids] } },
    select: {
      id: true,
      flightNumber: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      depLat: true,
      depLon: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
      depTimezone: true,
      arrTimezone: true,
      depPrecision: true,
      arrPrecision: true,
      actualDeparture: true,
      actualArrival: true,
      runwayDepartureTime: true,
      runwayArrivalTime: true,
      onlineCheckInOpensAt: true,
      onlineCheckInZone: true,
    },
  });
  const out = new Map<string, Described>();
  for (const f of flights) {
    const [dep, arr] = await Promise.all([
      getAirportTimezone(f.depIata ?? f.depIcao),
      getAirportTimezone(f.arrIata ?? f.arrIcao),
    ]);
    const times = flightTimes(f, { dep, arr });
    // Off-block to on-block where known, else the schedule: the recorder's
    // window is wider on purpose and would label the taxi to the gate a flight.
    const fromMs = instantOf(times.actualDeparture) ?? instantOf(times.departure);
    const untilMs = instantOf(times.actualArrival) ?? instantOf(times.arrival);
    out.set(f.id, {
      label: joined(f.flightNumber, route(f.depIata ?? f.depIcao, f.arrIata ?? f.arrIcao)),
      href: `/flights/${f.id}`,
      pin: pinOf(f.depLat, f.depLon),
      ...(fromMs !== null && untilMs !== null && untilMs > fromMs
        ? { span: { fromMs, untilMs } }
        : {}),
    });
  }
  return out;
};

const RIDE_SELECT = {
  id: true,
  operator: true,
  depStationName: true,
  arrStationName: true,
  depLat: true,
  depLon: true,
} as const;

type Ride = {
  id: string;
  operator: string | null;
  depStationName: string;
  arrStationName: string;
  depLat: number;
  depLon: number;
};

const ride = (path: string, row: Ride, name: string | null): Described => ({
  label: joined(name ?? row.operator, route(row.depStationName, row.arrStationName)),
  href: `/${path}/${row.id}`,
  pin: pinOf(row.depLat, row.depLon),
});

const describeRail: Describer = async (userId, ids) =>
  byId(
    await prisma.railJourney.findMany({
      where: { userId, id: { in: [...ids] } },
      select: { ...RIDE_SELECT, trainNumber: true },
    }),
    (r) => ride("rail", r, r.trainNumber)
  );

const describeBus: Describer = async (userId, ids) =>
  byId(
    await prisma.busJourney.findMany({
      where: { userId, id: { in: [...ids] } },
      select: { ...RIDE_SELECT, lineName: true },
    }),
    (r) => ride("bus", r, r.lineName)
  );

const describeFerry: Describer = async (userId, ids) =>
  byId(
    await prisma.ferryJourney.findMany({
      where: { userId, id: { in: [...ids] } },
      select: { ...RIDE_SELECT, vesselName: true },
    }),
    (r) => ride("ferry", r, r.vesselName)
  );

const describeCruises: Describer = async (userId, ids) =>
  byId(
    await prisma.cruise.findMany({
      where: { userId, id: { in: [...ids] } },
      select: {
        id: true,
        routeName: true,
        shipNameOverride: true,
        ship: { select: { name: true } },
        departurePort: { select: { name: true, lat: true, lon: true } },
      },
    }),
    (c) => ({
      label: c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? c.departurePort?.name ?? "",
      href: `/cruises/${c.id}`,
      pin: pinOf(c.departurePort?.lat, c.departurePort?.lon),
    })
  );

const describeRentals: Describer = async (userId, ids) =>
  byId(
    await prisma.rentalBooking.findMany({
      where: { userId, id: { in: [...ids] } },
      select: {
        id: true,
        provider: true,
        pickupStationName: true,
        pickupLat: true,
        pickupLon: true,
      },
    }),
    (r) => ({
      label: joined(r.provider, r.pickupStationName),
      href: `/rentals/${r.id}`,
      pin: pinOf(r.pickupLat, r.pickupLon),
    })
  );

/** A roadtrip spans days and places: it has no single pin, its stretch anchors it. */
const describeRoadtrips: Describer = async (userId, ids) =>
  byId(
    await prisma.tripRoute.findMany({
      where: { userId, id: { in: [...ids] } },
      select: { id: true, name: true },
    }),
    (r) => ({ label: r.name, href: `/roadtrips/${r.id}`, pin: null })
  );

const describeLodging: Describer = async (userId, ids) =>
  byId(
    await prisma.lodgingStay.findMany({
      where: { userId, id: { in: [...ids] } },
      select: { id: true, lodging: { select: { id: true, name: true, lat: true, lon: true } } },
    }),
    (s) => ({
      label: s.lodging.name,
      href: `/lodging/${s.lodging.id}`,
      pin: pinOf(s.lodging.lat, s.lodging.lon),
    })
  );

const describePlaceVisits: Describer = async (userId, ids) =>
  byId(
    await prisma.placeVisit.findMany({
      where: { userId, id: { in: [...ids] } },
      select: { id: true, place: { select: { id: true, name: true, lat: true, lon: true } } },
    }),
    (v) => ({
      label: v.place.name,
      href: `/places/${v.place.id}`,
      pin: pinOf(v.place.lat, v.place.lon),
    })
  );

export const DAY_LABEL_DESCRIBERS: Record<DomainKey, Describer> = {
  flight: describeFlights,
  cruise: describeCruises,
  lodging: describeLodging,
  poi: describePlaceVisits,
  roadtrip: describeRoadtrips,
  rail: describeRail,
  rental: describeRentals,
  bus: describeBus,
  ferry: describeFerry,
};
