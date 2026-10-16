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
  SHARE_LINK_MAX_NOTES,
  SHARE_LINK_MAX_PHOTOS,
  type ShareLinkField,
  type TripView,
} from "../../schemas/shareLinks";
import { daysBetween } from "../../shared/time/localDate";
import { calculateDistance } from "../../utils/geo";
import { tripPageCost } from "../trip/tripCostSuperlative";
import { withTripTimes } from "../trips/timesDto";
import { toNoteDto } from "../notes/noteService";
import { notesInSpan, tripDaySpan } from "../notes/tripNotes";
import { shareablePhotoIds } from "./photoProxy";

/**
 * The public view of one trip — the share card and Trip Wrapped (forgejo#154,
 * companion#39). Field by field, like the flight view: the trip row's notes,
 * journal, documents, seats, booking references and every id stay where they
 * are because no line below reads them. Standalone notes travel only through
 * the `notes` field, and only the owner's shareable ones.
 *
 * Counting reuses the trip page's own homes — `tripCountries` for the
 * countries, `tripPageCost` for the money — so the card cannot disagree with
 * the page it was made from.
 */

const TRIP_VIEW_SELECT = {
  id: true,
  name: true,
  countries: true,
  companions: true,
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
  const [flights, rail, bus, cruises] = await Promise.all([
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
      select: { depStationName: true, arrStationName: true, departureTime: true },
      orderBy: { departureTime: "asc" },
    }),
    prisma.busJourney.findMany({
      where: { tripId, ...NOT_CANCELLED },
      select: { depStationName: true, arrStationName: true, departureTime: true },
      orderBy: { departureTime: "asc" },
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
  return { flights, rail, bus, cruises };
}
type Legs = Awaited<ReturnType<typeof loadLegs>>;

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

async function companionsOf(trip: TripRow): Promise<string[]> {
  const links = await prisma.tripCompanion.findMany({
    where: { tripId: trip.id },
    orderBy: { position: "asc" },
    select: { companion: { select: { displayName: true } } },
  });
  return links.length > 0 ? links.map((l) => l.companion.displayName) : trip.companions;
}

async function costsOf(userId: string, tripId: string): Promise<TripView["costs"]> {
  const cost = await tripPageCost(userId, tripId);
  if (!cost) return null;
  const byCurrency = Object.entries(cost.spendByCurrency)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  if (byCurrency.length === 0) return null;
  return { byCurrency, complete: cost.unpricedEntries === 0 };
}

/**
 * The owner's SHAREABLE notes on the trip's days (forgejo#146). The
 * visibility filter is part of the query, so a private note is never even
 * loaded here; text, place name and moment only — no position, photo or id.
 */
async function notesOf(userId: string, trip: TripRow): Promise<TripView["notes"]> {
  const span = tripDaySpan(trip);
  if (!span) return { items: [], truncated: false };
  const { notes, truncated } = await notesInSpan(userId, span, {
    visibility: "shareable",
    limit: SHARE_LINK_MAX_NOTES,
  });
  return {
    items: notes.map((note) => {
      const { times } = toNoteDto(note);
      return { body: note.body, placeName: note.placeName, at: times.occurredAt, day: times.day };
    }),
    truncated,
  };
}

export async function buildTripView(
  userId: string,
  trip: TripRow,
  fields: ReadonlySet<ShareLinkField<"trip">>,
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
      railRides: legs.rail.length,
      busRides: legs.bus.length,
      countries: countries.length,
      days: times.start && times.end ? daysBetween(times.start.date, times.end.date) + 1 : null,
    };
  }
  if (legs && fields.has("route")) view.route = routeOf(legs);
  if (fields.has("costs")) view.costs = await costsOf(userId, trip.id);
  if (fields.has("companions")) view.companions = await companionsOf(trip);
  if (fields.has("photos")) {
    const live = await shareablePhotoIds(trip.id, photoIds);
    view.photos = { count: Math.min(live.length, SHARE_LINK_MAX_PHOTOS) };
  }
  if (fields.has("notes")) view.notes = await notesOf(userId, trip);
  return view;
}
