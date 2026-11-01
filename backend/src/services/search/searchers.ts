import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { getCachedAirport } from "../airportCache";
import { flightTimes, type FlightTimeColumns } from "../flights/timesDto";
import { serializeDay, type LocalDateValue } from "../../shared/time/wire";
import { dayAt, dbDay, joinParts, page, type DomainSearcher, type SearchHit } from "./types";

/**
 * One searcher per domain. Every one is owner-scoped on `userId` first (the
 * indexed column), matches with a case-insensitive `contains` (Prisma escapes
 * `%`, `_` and `\` by hand, so a typed wildcard is a character), takes `limit + 1` rows so
 * "more exist" costs no count, and orders newest first with the id as the
 * tie-breaker — a total order, so the same query answers the same way.
 */

/** Prisma passes `contains` through to LIKE unescaped; a typed `%` or `_` must stay a character. */
const escapeLike = (q: string): string => q.replace(/[\\%_]/g, "\\$&");

const ci = (q: string): { contains: string; mode: "insensitive" } => ({
  contains: escapeLike(q),
  mode: "insensitive",
});

const NEWEST = (field: string): Record<string, unknown>[] => [
  { [field]: { sort: "desc", nulls: "last" } },
  { id: "desc" },
];

/** For a NOT NULL date column: nulls cannot occur, so no `nulls` clause. */
const LATEST = (field: string): Record<string, unknown>[] => [{ [field]: "desc" }, { id: "desc" }];

const arrow = (a: string | null | undefined, b: string | null | undefined): string | null =>
  a && b ? `${a} → ${b}` : (a ?? b ?? null);

/** `MUC-VIE`, `muc → vie`, `FRA VIE`: two airport codes typed as a route. */
function routePair(q: string): [string, string] | null {
  const tokens = q.split(/\s*(?:-|–|→|>|\s)\s*/).filter(Boolean);
  if (tokens.length !== 2) return null;
  return tokens.every((t) => /^[A-Za-z]{3,4}$/.test(t)) ? [tokens[0], tokens[1]] : null;
}

/** The departure's local day, read the way every flight read does (`flightTimes`): stored zone, else today's catalogue zone. */
async function flightDepartureDay(
  f: FlightTimeColumns & {
    depIata: string | null;
    depIcao: string | null;
    arrIata: string | null;
    arrIcao: string | null;
  }
): Promise<LocalDateValue | null> {
  if (!f.departureTime) return null;
  const catalogue = async (stored: string | null, iata: string | null, icao: string | null) => {
    if (stored) return stored;
    for (const code of [iata, icao]) {
      if (!code) continue;
      const airport = await getCachedAirport(code).catch(() => null);
      if (airport?.timezone) return airport.timezone;
    }
    return null;
  };
  const dep = await catalogue(f.depTimezone, f.depIata, f.depIcao);
  const departure = flightTimes(f, { dep, arr: null }).departure;
  return departure ? serializeDay(departure.local.slice(0, 10), departure.zone, "day") : null;
}

export const searchFlights: DomainSearcher = async (userId, q, limit) => {
  const route = routePair(q);
  const airport = (side: "dep" | "arr", code: string): Prisma.FlightWhereInput => ({
    OR: [
      { [`${side}Iata`]: { equals: code, mode: "insensitive" } },
      { [`${side}Icao`]: { equals: code, mode: "insensitive" } },
    ],
  });
  const where: Prisma.FlightWhereInput = {
    userId,
    OR: [
      { flightNumber: ci(q) },
      { airline: ci(q) },
      { airlineIata: ci(q) },
      { depIata: ci(q) },
      { arrIata: ci(q) },
      { depName: ci(q) },
      { arrName: ci(q) },
      ...(route ? [{ AND: [airport("dep", route[0]), airport("arr", route[1])] }] : []),
    ],
  };
  const rows = await prisma.flight.findMany({
    where,
    orderBy: NEWEST("departureTime") as Prisma.FlightOrderByWithRelationInput[],
    take: limit + 1,
    select: {
      id: true,
      flightNumber: true,
      airline: true,
      airlineIata: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
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
  const { rows: shown, more } = page(rows, limit);
  const zones = await Promise.all(shown.map((f) => flightDepartureDay(f)));
  return {
    more,
    hits: shown.map((f, i) => {
      const code = f.flightNumber
        ? f.flightNumber.startsWith(f.airlineIata ?? "\0")
          ? f.flightNumber
          : joinParts([f.airlineIata, f.flightNumber], " ")
        : null;
      const route = arrow(f.depIata ?? f.depIcao, f.arrIata ?? f.arrIcao);
      return {
        domain: "flight",
        kind: "flight",
        id: f.id,
        title: code ?? route ?? f.airline ?? "—",
        subtitle: code ? joinParts([route, f.airline]) : f.airline,
        date: zones[i],
        path: `/flights/${f.id}`,
      } satisfies SearchHit;
    }),
  };
};

export const searchCruises: DomainSearcher = async (userId, q, limit) => {
  const rows = await prisma.cruise.findMany({
    where: {
      userId,
      OR: [
        { shipNameOverride: ci(q) },
        { cruiseLine: ci(q) },
        { routeName: ci(q) },
        { ship: { is: { name: ci(q) } } },
        { departurePort: { is: { name: ci(q) } } },
        { arrivalPort: { is: { name: ci(q) } } },
        {
          stops: {
            some: { OR: [{ port: { is: { name: ci(q) } } }, { unresolvedPortName: ci(q) }] },
          },
        },
      ],
    },
    orderBy: NEWEST("startDate") as Prisma.CruiseOrderByWithRelationInput[],
    take: limit + 1,
    select: {
      id: true,
      shipNameOverride: true,
      cruiseLine: true,
      routeName: true,
      startDate: true,
      startDay: true,
      startZone: true,
      ship: { select: { name: true } },
      departurePort: { select: { name: true } },
      arrivalPort: { select: { name: true } },
    },
  });
  const { rows: shown, more } = page(rows, limit);
  return {
    more,
    hits: shown.map((c) => ({
      domain: "cruise",
      kind: "cruise",
      id: c.id,
      title: c.shipNameOverride ?? c.ship?.name ?? c.routeName ?? c.cruiseLine ?? "—",
      subtitle: joinParts([c.cruiseLine, arrow(c.departurePort?.name, c.arrivalPort?.name)]),
      date: c.startDay ? dbDay(c.startDay, c.startZone) : dayAt(c.startDate, c.startZone),
      path: `/cruises/${c.id}`,
    })),
  };
};

export const searchLodging: DomainSearcher = async (userId, q, limit) => {
  const rows = await prisma.lodging.findMany({
    where: {
      userId,
      OR: [{ name: ci(q) }, { city: ci(q) }, { chain: { is: { name: ci(q) } } }],
    },
    // A house has no date of its own; its latest stay orders the list, the
    // id keeps it total.
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      name: true,
      city: true,
      chain: { select: { name: true } },
      stays: {
        select: { checkIn: true, checkInDate: true, stayZone: true },
        orderBy: { checkIn: "desc" },
        take: 1,
      },
    },
  });
  const { rows: shown, more } = page(rows, limit);
  return {
    more,
    hits: shown.map((l) => ({
      domain: "lodging",
      kind: "lodging",
      id: l.id,
      title: l.name,
      subtitle: joinParts([l.city, l.chain?.name]),
      date: l.stays[0]?.checkInDate
        ? dbDay(l.stays[0].checkInDate, l.stays[0].stayZone)
        : dayAt(l.stays[0]?.checkIn, l.stays[0]?.stayZone),
      path: `/lodging/${l.id}`,
    })),
  };
};

export const searchPlaces: DomainSearcher = async (userId, q, limit) => {
  const [places, lists] = await Promise.all([
    prisma.place.findMany({
      where: {
        userId,
        OR: [
          { name: ci(q) },
          { localName: ci(q) },
          { city: ci(q) },
          { listEntries: { some: { list: { is: { name: ci(q) } } } } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        city: true,
        category: true,
        listEntries: { select: { list: { select: { name: true } } }, take: 3 },
      },
    }),
    prisma.placeList.findMany({
      where: { userId, name: ci(q) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, name: true },
    }),
  ]);
  // Lists get a reserved share of the slots: a place also matches through its
  // list's name, so places alone could crowd a matching list out for good.
  const listShown = lists.slice(0, Math.min(lists.length, Math.ceil(limit / 2)));
  const placeShown = places.slice(0, limit - listShown.length);
  const hits: SearchHit[] = [
    ...placeShown.map((r): SearchHit => ({
      domain: "poi",
      kind: "place",
      id: r.id,
      title: r.name,
      subtitle: joinParts([r.city, ...r.listEntries.map((e) => e.list.name)]),
      date: null,
      path: `/places/${r.id}`,
    })),
    ...listShown.map((r): SearchHit => ({
      domain: "poi",
      kind: "placeList",
      id: r.id,
      title: r.name,
      subtitle: null,
      date: null,
      path: `/places/lists/${r.id}`,
    })),
  ];
  return { hits, more: places.length > placeShown.length || lists.length > listShown.length };
};

type RideRow = {
  id: string;
  dep: string;
  arr: string;
  departureTime: Date | null;
  depTimezone: string | null;
  depPrecision: string | null;
};

function rideHit(domain: "rail" | "bus" | "ferry", r: RideRow, label: string | null): SearchHit {
  const route = arrow(r.dep, r.arr);
  return {
    domain,
    kind: domain,
    id: r.id,
    title: label ?? route ?? "—",
    subtitle: label ? route : null,
    date: dayAt(
      r.departureTime,
      r.depTimezone,
      r.depPrecision === "month" || r.depPrecision === "year" ? r.depPrecision : "day"
    ),
    path: `/${domain}/${r.id}`,
  };
}

export const searchRail: DomainSearcher = async (userId, q, limit) => {
  const rows = await prisma.railJourney.findMany({
    where: {
      userId,
      OR: [
        { trainNumber: ci(q) },
        { trainCategory: ci(q) },
        { depStationName: ci(q) },
        { arrStationName: ci(q) },
      ],
    },
    orderBy: LATEST("departureTime") as Prisma.RailJourneyOrderByWithRelationInput[],
    take: limit + 1,
    select: {
      id: true,
      trainCategory: true,
      trainNumber: true,
      depStationName: true,
      arrStationName: true,
      departureTime: true,
      depTimezone: true,
      depPrecision: true,
    },
  });
  const { rows: shown, more } = page(rows, limit);
  return {
    more,
    hits: shown.map((r) =>
      rideHit(
        "rail",
        {
          id: r.id,
          dep: r.depStationName,
          arr: r.arrStationName,
          departureTime: r.departureTime,
          depTimezone: r.depTimezone,
          depPrecision: r.depPrecision,
        },
        joinParts([r.trainCategory, r.trainNumber], " ")
      )
    ),
  };
};

export const searchBus: DomainSearcher = async (userId, q, limit) => {
  const rows = await prisma.busJourney.findMany({
    where: {
      userId,
      OR: [{ lineName: ci(q) }, { depStationName: ci(q) }, { arrStationName: ci(q) }],
    },
    orderBy: LATEST("departureTime") as Prisma.BusJourneyOrderByWithRelationInput[],
    take: limit + 1,
    select: {
      id: true,
      lineName: true,
      depStationName: true,
      arrStationName: true,
      departureTime: true,
      depTimezone: true,
      depPrecision: true,
    },
  });
  const { rows: shown, more } = page(rows, limit);
  return {
    more,
    hits: shown.map((r) =>
      rideHit(
        "bus",
        {
          id: r.id,
          dep: r.depStationName,
          arr: r.arrStationName,
          departureTime: r.departureTime,
          depTimezone: r.depTimezone,
          depPrecision: r.depPrecision,
        },
        r.lineName
      )
    ),
  };
};

export const searchFerry: DomainSearcher = async (userId, q, limit) => {
  const rows = await prisma.ferryJourney.findMany({
    where: {
      userId,
      OR: [{ vesselName: ci(q) }, { depStationName: ci(q) }, { arrStationName: ci(q) }],
    },
    orderBy: LATEST("departureTime") as Prisma.FerryJourneyOrderByWithRelationInput[],
    take: limit + 1,
    select: {
      id: true,
      vesselName: true,
      depStationName: true,
      arrStationName: true,
      departureTime: true,
      depTimezone: true,
      depPrecision: true,
    },
  });
  const { rows: shown, more } = page(rows, limit);
  return {
    more,
    hits: shown.map((r) =>
      rideHit(
        "ferry",
        {
          id: r.id,
          dep: r.depStationName,
          arr: r.arrStationName,
          departureTime: r.departureTime,
          depTimezone: r.depTimezone,
          depPrecision: r.depPrecision,
        },
        r.vesselName
      )
    ),
  };
};

export const searchRentals: DomainSearcher = async (userId, q, limit) => {
  const rows = await prisma.rentalBooking.findMany({
    where: {
      userId,
      OR: [
        { operatedBy: ci(q) },
        { pickupStationName: ci(q) },
        { returnStationName: ci(q) },
        { vehicleExample: ci(q) },
      ],
    },
    orderBy: LATEST("pickupTime") as Prisma.RentalBookingOrderByWithRelationInput[],
    take: limit + 1,
    select: {
      id: true,
      operatedBy: true,
      pickupStationName: true,
      returnStationName: true,
      vehicleExample: true,
      pickupTime: true,
      pickupTimezone: true,
    },
  });
  const { rows: shown, more } = page(rows, limit);
  return {
    more,
    hits: shown.map((r) => ({
      domain: "rental",
      kind: "rental",
      id: r.id,
      title: r.operatedBy ?? r.pickupStationName,
      subtitle: joinParts([
        r.operatedBy ? r.pickupStationName : null,
        r.returnStationName !== r.pickupStationName ? `→ ${r.returnStationName}` : null,
        r.vehicleExample,
      ]),
      date: dayAt(r.pickupTime, r.pickupTimezone),
      path: `/rentals/${r.id}`,
    })),
  };
};

function routeSearcher(kind: "tour" | "roadtrip"): DomainSearcher {
  return async (userId, q, limit) => {
    const rows = await prisma.tripRoute.findMany({
      where: {
        userId,
        kind,
        OR: [{ name: ci(q) }, ...(kind === "roadtrip" ? [{ vehicleName: ci(q) }] : [])],
      },
      // A roadtrip has no date of its own (`tourDate` is the day tour's): its
      // first station dates it, and the row order falls back to last edited.
      orderBy:
        kind === "tour"
          ? (NEWEST("tourDate") as Prisma.TripRouteOrderByWithRelationInput[])
          : [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        vehicleName: true,
        tourDate: true,
        stops: {
          select: { startDate: true, startUtc: true, stopZone: true },
          orderBy: { startDate: "asc" },
          take: 1,
        },
      },
    });
    const { rows: shown, more } = page(rows, limit);
    return {
      more,
      hits: shown.map((r) => ({
        domain: kind,
        kind,
        id: r.id,
        title: r.name,
        subtitle: kind === "roadtrip" ? r.vehicleName : null,
        // A tour day names no place; a roadtrip is dated by its first station on that station's clock.
        date:
          kind === "tour"
            ? dbDay(r.tourDate, null)
            : r.stops[0]?.startUtc
              ? dayAt(r.stops[0].startUtc, r.stops[0].stopZone)
              : dayAt(r.stops[0]?.startDate, null),
        path: kind === "tour" ? `/tours/${r.id}` : `/roadtrips/${r.id}`,
      })),
    };
  };
}

export const searchTours = routeSearcher("tour");
export const searchRoadtrips = routeSearcher("roadtrip");

export const searchTrips: DomainSearcher = async (userId, q, limit) => {
  const rows = await prisma.trip.findMany({
    where: {
      userId,
      OR: [{ name: ci(q) }, { originLabel: ci(q) }, { destinationLabel: ci(q) }],
    },
    orderBy: NEWEST("startDate") as Prisma.TripOrderByWithRelationInput[],
    take: limit + 1,
    select: {
      id: true,
      name: true,
      originLabel: true,
      destinationLabel: true,
      startDate: true,
      startDay: true,
      startZone: true,
    },
  });
  const { rows: shown, more } = page(rows, limit);
  return {
    more,
    hits: shown.map((t) => ({
      domain: "trip",
      kind: "trip",
      id: t.id,
      title: t.name,
      subtitle: arrow(t.originLabel, t.destinationLabel),
      date: t.startDay ? dbDay(t.startDay, t.startZone) : dayAt(t.startDate, t.startZone),
      path: `/trips/${t.id}`,
    })),
  };
};
