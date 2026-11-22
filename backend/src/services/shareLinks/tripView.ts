import { prisma } from "../../db";
import {
  airportFactsFor,
  cruiseCountriesByTrip,
  lodgingCountriesByTrip,
  rideCountriesByTrip,
  roadtripCountriesByTrip,
  tripCountries,
} from "../../routes/trips/tripCountries";
import {
  SHARE_LINK_ITINERARY_SECTIONS,
  SHARE_LINK_MAX_PHOTOS,
  type ShareLinkItinerarySection,
  type TripView,
} from "../../schemas/shareLinks";
import { daysBetween } from "../../shared/time/localDate";
import { calculateDistance } from "../../utils/geo";
import { tripTimes, withTripTimes } from "../trips/timesDto";
import { segmentTripSpan } from "../timeModel/tripColumns";
import { RAIL_CLOCK_SELECT } from "../../shared/railClock";
import type { LocalDateValue } from "../../shared/time/wire";
import { buildItinerary } from "./itineraryView";
import { shareablePhotoIds } from "./photoProxy";
import { isCountedRailMode } from "../../shared/railCounting";

/**
 * The public view of one trip — the family itinerary and the share card
 * (forgejo#154, companion#39, redesigned 2026-11-22). Field by field: the trip
 * row's notes, journal, documents, seats, booking references, prices,
 * companions and every id stay where they are because no line below reads
 * them (owner decision 2026-11-22: costs, companions and notes no longer
 * travel at all).
 *
 * Counting reuses the trip page's own home — `tripCountries` for the
 * countries — so the card cannot disagree with the page it was made from.
 */

const TRIP_VIEW_SELECT = {
  id: true,
  name: true,
  countries: true,
  startDate: true,
  endDate: true,
  startDay: true,
  endDay: true,
  startZone: true,
  endZone: true,
} as const;

export async function loadOwnedTrip(userId: string, tripId: string) {
  return prisma.trip.findFirst({ where: { id: tripId, userId }, select: TRIP_VIEW_SELECT });
}
type TripRow = NonNullable<Awaited<ReturnType<typeof loadOwnedTrip>>>;

/** A cancelled leg never happened: no total, route or country counts it. */
const NOT_CANCELLED = { status: { not: "cancelled" } } as const;

async function loadLegs(tripId: string) {
  const [flights, rail, bus, ferry, rentals, cruises] = await Promise.all([
    prisma.flight.findMany({
      where: { tripId, ...NOT_CANCELLED },
      select: {
        depIata: true,
        depIcao: true,
        arrIata: true,
        arrIcao: true,
        depLat: true,
        depLon: true,
        arrLat: true,
        arrLon: true,
        departureTime: true,
      },
      orderBy: { departureTime: "asc" },
    }),
    prisma.railJourney.findMany({
      where: { tripId, ...NOT_CANCELLED },
      select: {
        depStationName: true,
        arrStationName: true,
        departureTime: true,
        transitMode: true,
      },
      orderBy: { departureTime: "asc" },
    }),
    prisma.busJourney.findMany({
      where: { tripId, ...NOT_CANCELLED },
      select: { depStationName: true, arrStationName: true, departureTime: true },
      orderBy: { departureTime: "asc" },
    }),
    prisma.ferryJourney.findMany({
      where: { tripId, ...NOT_CANCELLED },
      select: { depStationName: true, arrStationName: true, departureTime: true },
      orderBy: { departureTime: "asc" },
    }),
    prisma.rentalBooking.findMany({
      where: { tripId, ...NOT_CANCELLED },
      select: { pickupStationName: true, returnStationName: true, pickupTime: true },
      orderBy: { pickupTime: "asc" },
    }),
    prisma.cruise.findMany({
      where: { tripId, ...NOT_CANCELLED },
      select: {
        startDate: true,
        departurePort: { select: { name: true } },
        arrivalPort: { select: { name: true } },
      },
      orderBy: { startDate: "asc" },
    }),
  ]);
  return { flights, rail, bus, ferry, rentals, cruises };
}
type Legs = Awaited<ReturnType<typeof loadLegs>>;

const RIDE_END_SELECT = {
  ...RAIL_CLOCK_SELECT,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
} as const;

/**
 * The trip's last day for an itinerary link (forgejo#317): its own end, else
 * the end its entries date — by the same rule that fills an auto-created
 * trip's dates (`segmentTripSpan`), over the entries the itinerary shows, so
 * a cancelled leg cannot hold a link open. A trip whose dates were never
 * filled (`MUC ↺ KOA · Mar 2013`) otherwise kept its link open past the trip.
 * Null when neither names a day: the owner's own expiry is then the only end.
 */
export async function tripLastDay(trip: TripRow): Promise<LocalDateValue | null> {
  const own = tripTimes(trip).end;
  if (own) return own;
  const [flights, rail, bus, ferry, cruises] = await Promise.all([
    prisma.flight.findMany({
      where: { tripId: trip.id, ...NOT_CANCELLED },
      select: RIDE_END_SELECT,
    }),
    prisma.railJourney.findMany({
      where: { tripId: trip.id, ...NOT_CANCELLED },
      select: RIDE_END_SELECT,
    }),
    prisma.busJourney.findMany({
      where: { tripId: trip.id, ...NOT_CANCELLED },
      select: RIDE_END_SELECT,
    }),
    prisma.ferryJourney.findMany({
      where: { tripId: trip.id, ...NOT_CANCELLED },
      select: RIDE_END_SELECT,
    }),
    prisma.cruise.findMany({
      where: { tripId: trip.id, ...NOT_CANCELLED },
      select: { startDate: true, endDate: true },
    }),
  ]);
  const span = segmentTripSpan([...flights, ...rail, ...bus, ...ferry], cruises);
  return span ? tripTimes({ ...trip, ...span }).end : null;
}

async function countriesOf(trip: TripRow, legs: Legs): Promise<string[]> {
  const [facts, cruise, lodging, roadtrip, ride] = await Promise.all([
    airportFactsFor(legs.flights),
    cruiseCountriesByTrip([trip.id]),
    lodgingCountriesByTrip([trip.id]),
    roadtripCountriesByTrip([trip.id]),
    rideCountriesByTrip([trip.id]),
  ]);
  return tripCountries(
    trip.countries,
    legs.flights,
    facts,
    cruise.get(trip.id) ?? [],
    lodging.get(trip.id) ?? [],
    roadtrip.get(trip.id) ?? [],
    ride.get(trip.id) ?? []
  );
}

/** Every leg in time order, codes and names only — no times, no seats. */
function routeOf(legs: Legs): NonNullable<TripView["route"]> {
  const at = (d: Date | null) => d?.getTime() ?? Number.POSITIVE_INFINITY;
  const entries = [
    ...legs.flights.map((f) => ({
      t: at(f.departureTime),
      leg: { mode: "flight" as const, from: f.depIata ?? f.depIcao, to: f.arrIata ?? f.arrIcao },
    })),
    ...legs.rail.map((r) => ({
      t: at(r.departureTime),
      leg: { mode: "rail" as const, from: r.depStationName, to: r.arrStationName },
    })),
    ...legs.bus.map((r) => ({
      t: at(r.departureTime),
      leg: { mode: "bus" as const, from: r.depStationName, to: r.arrStationName },
    })),
    ...legs.ferry.map((r) => ({
      t: at(r.departureTime),
      leg: { mode: "ferry" as const, from: r.depStationName, to: r.arrStationName },
    })),
    ...legs.rentals.map((r) => ({
      t: at(r.pickupTime),
      leg: { mode: "rental" as const, from: r.pickupStationName, to: r.returnStationName },
    })),
    ...legs.cruises.map((c) => ({
      t: at(c.startDate),
      leg: {
        mode: "cruise" as const,
        from: c.departurePort?.name ?? null,
        to: c.arrivalPort?.name ?? null,
      },
    })),
  ];
  return entries.sort((a, b) => a.t - b.t).map((e) => e.leg);
}

export async function buildTripView(
  trip: TripRow,
  fields: ReadonlySet<string>,
  ownerFirstName: string | null,
  photoIds: readonly string[]
): Promise<TripView> {
  const view: TripView = {};
  const needsLegs = fields.has("totals") || fields.has("route") || fields.has("countries");
  const legs = needsLegs ? await loadLegs(trip.id) : null;
  const { times } = withTripTimes(trip);

  if (fields.has("owner")) view.owner = ownerFirstName;
  if (fields.has("name")) view.name = trip.name;
  if (fields.has("dates")) view.dates = { start: times.start, end: times.end };
  const countries =
    legs && (fields.has("countries") || fields.has("totals")) ? await countriesOf(trip, legs) : [];
  if (fields.has("countries")) view.countries = countries;
  if (legs && fields.has("totals")) {
    const km = legs.flights.reduce(
      (sum, f) => sum + calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon),
      0
    );
    view.totals = {
      flights: legs.flights.length,
      flightKm: legs.flights.length > 0 ? Math.round(km) : null,
      cruises: legs.cruises.length,
      // A U-Bahn or tram ride is on the route, but no train ride (`railCounting`).
      railRides: legs.rail.filter(isCountedRailMode).length,
      busRides: legs.bus.length,
      ferryCrossings: legs.ferry.length,
      rentals: legs.rentals.length,
      countries: countries.length,
      days: times.start && times.end ? daysBetween(times.start.date, times.end.date) + 1 : null,
    };
  }
  if (legs && fields.has("route")) view.route = routeOf(legs);
  if (fields.has("photos")) {
    const live = await shareablePhotoIds(trip.id, photoIds);
    view.photos = { count: Math.min(live.length, SHARE_LINK_MAX_PHOTOS) };
  }
  const sections = itinerarySections(fields);
  if (sections.length > 0) view.itinerary = await buildItinerary(trip.id, sections);
  return view;
}

/**
 * The itinerary sections a link shows. A link made before 2026-11-22 names
 * only `itinerary`, which meant every entry — it keeps showing all four.
 * Stored fields no longer on the allow-list (`costs`, `companions`, `notes`)
 * are read by nothing here, so an old link stops showing them at once.
 */
export function itinerarySections(
  fields: ReadonlySet<string> | readonly string[]
): ShareLinkItinerarySection[] {
  const has = (f: string) =>
    Array.isArray(fields) ? fields.includes(f) : (fields as ReadonlySet<string>).has(f);
  const chosen = SHARE_LINK_ITINERARY_SECTIONS.filter(has);
  if (chosen.length > 0) return chosen;
  return has("itinerary") ? [...SHARE_LINK_ITINERARY_SECTIONS] : [];
}
