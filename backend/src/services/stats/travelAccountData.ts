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
import { buildTzMap, airportCalendarDay } from "./departureClock";
import type { FlightTimeSemantics } from "../../utils/timezone";
import type {
  AccountCruise,
  AccountFlight,
  AccountFreeNight,
  AccountStay,
  TravelAccountInput,
} from "./travelAccount";
import { freeStationNights, roadtripHasStarted } from "./roadtripEvidence";
import type { TripAccountInput } from "./tripAccount";

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
  trips: TripAccountInput[];
}

export async function loadTravelAccountData(userId: string): Promise<TravelAccountData> {
  const now = new Date();
  const [stays, cruises, flights, trips, roadtrips] = await Promise.all([
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
        lodgingStays: {
          select: {
            status: true,
            checkIn: true,
            checkOut: true,
            datePrecision: true,
            nights: true,
            totalPrice: true,
            currency: true,
            totalPriceBase: true,
            fxBaseCurrency: true,
          },
        },
        cruises: {
          select: {
            status: true,
            startDate: true,
            endDate: true,
            price: true,
            currency: true,
          },
        },
        flights: {
          select: {
            status: true,
            departureTime: true,
            arrivalTime: true,
            // The full cost shape `flightCostShare` needs: a flight's own
            // cost is price PLUS taxes and fees, and a booking shared by
            // several segments is counted once (AUD-080).
            price: true,
            taxes: true,
            fees: true,
            currency: true,
            priceBase: true,
            fxBaseCurrency: true,
            bookingId: true,
            booking: {
              select: {
                price: true,
                currency: true,
                priceBase: true,
                fxBaseCurrency: true,
              },
            },
          },
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
  ]);

  // Resolve both ends' calendar days here, at the load, so the account stays
  // a pure function over rows that carry their own answer (AUD-079).
  const tzMap = await buildTzMap(flights);

  return {
    stays: stays.map((s) => ({
      id: s.id,
      lodgingId: s.lodgingId,
      lodgingName: s.lodging.name,
      status: s.status,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
      datePrecision: s.datePrecision,
      nights: s.nights,
    })),
    cruises: cruises.map((c) => ({
      id: c.id,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      label: c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? "—",
    })),
    flights: flights.map((f) => {
      const depTz =
        (f.depIata ? tzMap.get(f.depIata) : undefined) ??
        (f.depIcao ? tzMap.get(f.depIcao) : undefined) ??
        null;
      const arrTz =
        (f.arrIata ? tzMap.get(f.arrIata) : undefined) ??
        (f.arrIcao ? tzMap.get(f.arrIcao) : undefined) ??
        null;
      return {
        id: f.id,
        status: f.status,
        departureTime: f.departureTime,
        arrivalTime: f.arrivalTime,
        flightNumber: f.flightNumber,
        depIata: f.depIata,
        arrIata: f.arrIata,
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
    freeNights: roadtrips
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
      stays: t.lodgingStays,
      cruises: t.cruises,
      flights: t.flights,
    })),
    now,
  };
}
