/**
 * The rows `GET /stats/travel-account` is built from, loaded once.
 *
 * Extracted from `routes/stats.ts` when the evidence panel began answering
 * the same nine numbers (task 7b-2). Two copies of this query would be two
 * populations: a `select` that gained a column on one side, a `where` that
 * narrowed on the other, and a panel naming rows the tile never counted.
 * The account and its evidence therefore load from ONE function; what
 * differs between them is only which figure is read out of the result.
 *
 * The extra columns the route itself does not need — a stay's lodging name,
 * a cruise's ship, a flight's number — are here because an evidence entry
 * has to render itself and a second query per page would defeat the point of
 * loading the account in one pass.
 */
import { prisma } from "../../db";
import { buildTzMap, airportCalendarDay, flightEndZone } from "./departureClock";
import type { FlightTimeSemantics } from "../../utils/timezone";
import type {
  AccountCruise,
  AccountFlight,
  AccountFreeNight,
  AccountBus,
  AccountRail,
  AccountStay,
  TravelAccountInput,
} from "./travelAccount";
import { freeStationNights, roadtripHasStarted } from "./roadtripEvidence";
import type { TripAccountInput } from "./tripAccount";
import type { ExpenseAccountRow } from "./expenseAccount";
import { TRIP_COST_SELECT, expenseMoney, toTripCostInput } from "../trip/tripCostLoad";
import { loadVisibleDomainSet, rowsIfVisible, type VisibleDomains } from "../domainVisibility";
import type { DomainKey } from "../../shared/domains";

/** A stay, plus what an evidence entry needs to name it and to link to it. */
export interface TravelAccountStayRow extends AccountStay {
  lodgingId: string;
  lodgingName: string;
}

export interface TravelAccountCruiseRow extends AccountCruise {
  /** Best available human name, resolved once here rather than per entry. */
  label: string;
}

export interface TravelAccountFlightRow extends AccountFlight {
  flightNumber: string | null;
  depIata: string | null;
  arrIata: string | null;
  /** The zone `depLocalDay` was read in — the evidence entry dates the flight on it too (forgejo#273). */
  depTimezone: string | null;
  depTimeSemantics: FlightTimeSemantics;
}

/** A train ride, plus the name its evidence entry renders (forgejo#266). */
export interface TravelAccountRailRow extends AccountRail {
  label: string;
}

/** A bus ride, plus what its evidence entry renders (forgejo#263). */
export interface TravelAccountBusRow extends AccountBus {
  operator: string | null;
  depStationName: string;
  arrStationName: string;
}

/** A free-pitch station, plus the roadtrip it belongs to — where it is edited. */
export interface TravelAccountFreeNightRow extends AccountFreeNight {
  roadtripId: string;
  roadtripName: string;
  title: string;
}

export interface TravelAccountData extends TravelAccountInput {
  stays: TravelAccountStayRow[];
  cruises: TravelAccountCruiseRow[];
  flights: TravelAccountFlightRow[];
  freeNights: TravelAccountFreeNightRow[];
  rail: TravelAccountRailRow[];
  bus: TravelAccountBusRow[];
  trips: TripAccountInput[];
  /** Every expense of the caller's, trip-wide or on a section (forgejo#140). */
  expenses: ExpenseAccountRow[];
}

/**
 * What a night train's nights are read from (`railRideKinds.nightTrainNights`):
 * its kind, both instants with their precision, and the stations' zones.
 */
const RAIL_NIGHT_SELECT = {
  id: true,
  status: true,
  trainCategory: true,
  travelClass: true,
  departureTime: true,
  arrivalTime: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
} as const;

/** What a night bus's nights are read from (`busRideKinds.nightBusNights`): both clocks and zones. */
const BUS_NIGHT_SELECT = {
  id: true,
  status: true,
  departureTime: true,
  arrivalTime: true,
  depTimezone: true,
  arrTimezone: true,
  depPrecision: true,
  arrPrecision: true,
} as const;

/**
 * `visible` is the user's domain gate (`domainVisibility.loadVisibleDomainSet`),
 * the same set the trips page prices with: every row of a domain the user does
 * not see is dropped here, from the nights, the coverage and the money alike,
 * so a trip has one total on both surfaces and a beta-gated domain shows on
 * neither (forgejo#274/#275/#266, controller ruling 2026-10-09).
 */
export async function loadTravelAccountData(
  userId: string,
  visible: VisibleDomains
): Promise<TravelAccountData> {
  const when = <T>(domain: DomainKey, rows: T[]): T[] => rowsIfVisible(visible, domain, rows);
  const now = new Date();
  const [stays, cruises, flights, trips, roadtrips, expenses, rail, bus] = await Promise.all([
    prisma.lodgingStay.findMany({
      where: { userId },
      select: {
        id: true,
        lodgingId: true,
        lodging: { select: { name: true } },
        status: true,
        checkIn: true,
        checkOut: true,
        datePrecision: true,
        nights: true,
      },
    }),
    prisma.cruise.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        startDate: true,
        endDate: true,
        routeName: true,
        shipNameOverride: true,
        ship: { select: { name: true } },
      },
    }),
    prisma.flight.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        departureTime: true,
        arrivalTime: true,
        flightNumber: true,
        // Needed to decide whether a flight took a NIGHT, which is a
        // question about the clocks at either end rather than about UTC.
        depIata: true,
        depIcao: true,
        arrIata: true,
        arrIcao: true,
        depTimeSemantics: true,
        arrTimeSemantics: true,
        depTimezone: true,
        arrTimezone: true,
      },
    }),
    prisma.trip.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        status: true,
        category: true,
        tags: true,
        journalEntries: { select: { mood: true, weather: true } },
        _count: { select: { photos: true } },
        // The cost rule's own columns (`TRIP_COST_SELECT`, shared with the
        // "most expensive trip" superlative — forgejo#274), plus the dates
        // coverage needs on the same rows.
        ...TRIP_COST_SELECT,
        lodgingStays: {
          select: {
            ...TRIP_COST_SELECT.lodgingStays.select,
            checkIn: true,
            checkOut: true,
            datePrecision: true,
            nights: true,
          },
        },
        cruises: {
          select: { ...TRIP_COST_SELECT.cruises.select, startDate: true, endDate: true },
        },
        flights: {
          select: { ...TRIP_COST_SELECT.flights.select, departureTime: true, arrivalTime: true },
        },
        // A night train covers its nights on the trip, as on the account.
        railJourneys: {
          select: { ...TRIP_COST_SELECT.railJourneys.select, ...RAIL_NIGHT_SELECT },
        },
        // A night bus covers its night as a night train does (forgejo#263).
        busJourneys: {
          select: { ...TRIP_COST_SELECT.busJourneys.select, ...BUS_NIGHT_SELECT },
        },
      },
    }),
    // Roadtrip stations, for the nights spent at a free pitch. The linked
    // stays are selected only for the "has it started" test the Stats
    // overview applies; their nights reach the account through `stays`.
    prisma.tripRoute.findMany({
      where: { userId, kind: "roadtrip" },
      select: {
        id: true,
        name: true,
        stops: {
          where: { viaPoint: false },
          select: {
            id: true,
            title: true,
            startDate: true,
            endDate: true,
            overnight: true,
            lodgingStayId: true,
            lodgingStay: {
              select: {
                checkIn: true,
                checkOut: true,
                datePrecision: true,
                nights: true,
                status: true,
              },
            },
          },
        },
      },
    }),
    prisma.tripExpense.findMany({
      where: { userId },
      select: { amount: true, currency: true, date: true, routeId: true },
    }),
    prisma.railJourney.findMany({
      where: { userId },
      select: {
        ...RAIL_NIGHT_SELECT,
        trainNumber: true,
        depStationName: true,
        arrStationName: true,
      },
    }),
    prisma.busJourney.findMany({
      where: { userId },
      select: { ...BUS_NIGHT_SELECT, operator: true, depStationName: true, arrStationName: true },
    }),
  ]);

  // Resolve both ends' calendar days here, at the load, so the account stays
  // a pure function over rows that carry their own answer (AUD-079).
  const tzMap = await buildTzMap(flights);

  return {
    stays: when("lodging", stays).map((s) => ({
      id: s.id,
      lodgingId: s.lodgingId,
      lodgingName: s.lodging.name,
      status: s.status,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      datePrecision: s.datePrecision,
      nights: s.nights,
    })),
    cruises: when("cruise", cruises).map((c) => ({
      id: c.id,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      label: c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? "—",
    })),
    flights: when("flight", flights).map((f) => {
      // Each end in the zone it was written with, else today's catalogue
      // zone — `flightEndZone`, as every other flight figure (forgejo#273).
      const depTz = flightEndZone(f.depTimezone, tzMap, f.depIata, f.depIcao);
      const arrTz = flightEndZone(f.arrTimezone, tzMap, f.arrIata, f.arrIcao);
      return {
        id: f.id,
        status: f.status,
        departureTime: f.departureTime,
        arrivalTime: f.arrivalTime,
        flightNumber: f.flightNumber,
        depIata: f.depIata,
        arrIata: f.arrIata,
        depTimezone: depTz,
        depTimeSemantics: f.depTimeSemantics as FlightTimeSemantics,
        depLocalDay:
          f.departureTime && depTz
            ? airportCalendarDay(f.departureTime, depTz, f.depTimeSemantics as FlightTimeSemantics)
            : null,
        arrLocalDay:
          f.arrivalTime && arrTz
            ? airportCalendarDay(f.arrivalTime, arrTz, f.arrTimeSemantics as FlightTimeSemantics)
            : null,
      };
    }),
    freeNights: when("roadtrip", roadtrips)
      // A planned roadtrip counts nowhere, the cut the Stats overview makes.
      .filter((route) => roadtripHasStarted(route.stops, now))
      .flatMap((route) =>
        route.stops.flatMap((stop) => {
          const span = freeStationNights(stop);
          return span
            ? [
                {
                  id: stop.id,
                  ...span,
                  roadtripId: route.id,
                  roadtripName: route.name,
                  title: stop.title,
                },
              ]
            : [];
        })
      ),
    rail: when("rail", rail).map(({ trainNumber, depStationName, arrStationName, ...ride }) => {
      const train = [ride.trainCategory, trainNumber].filter(Boolean).join(" ");
      const route = `${depStationName} → ${arrStationName}`;
      return { ...ride, label: train ? `${train} · ${route}` : route };
    }),
    bus: when("bus", bus),
    trips: trips.map((t) => ({
      id: t.id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      status: t.status,
      category: t.category,
      tags: t.tags,
      journalEntries: t.journalEntries,
      photoCount: t._count.photos,
      // The money from the gated rows, priced by the rule; the dated rows
      // below only say which nights the trip covers — through the same gate.
      cost: toTripCostInput(t, visible),
      stays: when("lodging", t.lodgingStays),
      cruises: when("cruise", t.cruises),
      flights: when("flight", t.flights),
      rail: when("rail", t.railJourneys),
      bus: when("bus", t.busJourneys),
    })),
    // A section's expense lives on its roadtrip page, behind that gate.
    expenses: [
      ...expenses.filter((e) => e.routeId === null),
      ...when(
        "roadtrip",
        expenses.filter((e) => e.routeId !== null)
      ),
    ].map((e) => ({ ...expenseMoney(e), date: e.date })),
    now,
  };
}

/**
 * `loadTravelAccountData` behind the user's OWN gate — what `/stats/travel-account`
 * and its evidence read, the set the trips page prices with (review I1).
 */
export async function loadVisibleTravelAccountData(userId: string): Promise<TravelAccountData> {
  return loadTravelAccountData(userId, await loadVisibleDomainSet(userId));
}
