import { Router, Response, NextFunction } from "express";
import { prisma } from "../db";
import { authenticate, AuthRequest } from "../middleware/auth";
import { getCachedAirports } from "../services/airportCache";
import { airportDisplayName } from "../utils/airportDisplay";
import { stayStartsAt } from "../utils/stayInstant";
import type { DomainKey } from "../shared/domains";
import { loadVisibleDomains } from "../services/domainVisibility";
import { endHasClock, rideEndsAt } from "../shared/railClock";

// No rate limiter, and deliberately so — for the same reason `stats.ts` has
// none, arrived at from the other side. This route exists BECAUSE the tab strip
// would otherwise make one call per domain; it is the consolidation. Its whole
// cost is four `findFirst`s with `take: 1` on indexed date columns, and it is
// on the render path of the dashboard the user opens first, so a per-user cap
// would fire on ordinary navigation and buy nothing.
const router = Router();
router.use(authenticate);

/**
 * What the dashboard's tab strip shows on the right: the next thing that has
 * not happened yet, per domain, plus the trip it belongs to.
 *
 * Why one route rather than four calls from the client: the strip sits ABOVE
 * the tabs and must not depend on which tab happens to have loaded its data.
 * The flight tab knows its flights, the cruise tab its cruises — the strip
 * knows neither, and asking every tab to publish an "upcoming" upwards is how
 * four slightly different definitions of "next" come about.
 *
 * "Upcoming" is a DATE in the future, never a stored status: the nightly sweep
 * only reverts strictly-future rows, so an imported row still marked as past
 * would drop out of a status filter while its date says otherwise. That is the
 * same rule `GET /flights/next` follows, and this route keeps it identical
 * rather than inventing a second one. Cancelled rows are excluded, because a
 * cancellation is a statement about the future, not a stale status.
 */

/** One upcoming entry. `domain` discriminates what `primary`/`secondary` mean. */
export interface UpcomingEntry {
  domain: DomainKey | "trip";
  id: string;
  /** ISO instant this starts — departure, embarkation, check-in, trip start. */
  startsAt: string;
  /**
   * Rail only: `day` when the ride was logged without a clock — `startsAt` is
   * then the start of that day at the station, not a departure time
   * (forgejo#132 item 17). Absent on the other domains.
   */
  startsAtPrecision?: "minute" | "day";
  /**
   * The row a click should OPEN, which is not always `id`: a stay has no page
   * of its own, so its target is the lodging whose page lists it. Always set,
   * so the strip has one rule (`<domain route>/<detailId>`) rather than a
   * per-domain special case — the strip used to link to the domain's LIST,
   * which made the entry a signpost to a page the reader then had to search
   * (#314).
   */
  detailId: string;
  /** The trip this belongs to, when it has one. Named so the strip can show it. */
  tripId: string | null;
  /**
   * That trip's NAME, so the strip can say which journey the entry is part of.
   * The id alone only supported the link — a reader could not see that the next
   * flight belongs to "Tokyo · Japan" (owner, 2026-08-14). Null when the entry
   * stands alone, and on a trip entry itself, whose `primary` IS the name.
   */
  tripName: string | null;
  /** The headline: "MUC → VIE", a ship, a hotel, a trip name. */
  primary: string;
  /** The qualifier under it: flight number, cruise line, city, destination. Empty when there is none. */
  secondary: string | null;
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

async function nextFlight(userId: string): Promise<UpcomingEntry | null> {
  const flight = await prisma.flight.findFirst({
    where: { userId, status: { not: "cancelled" }, departureTime: { gte: new Date() } },
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    select: {
      id: true,
      airlineIata: true,
      airline: true,
      flightNumber: true,
      depIata: true,
      arrIata: true,
      departureTime: true,
      tripId: true,
      trip: { select: { name: true } },
    },
  });
  const startsAt = iso(flight?.departureTime ?? null);
  if (!flight || !startsAt) return null;

  // Readable names where we have them, codes otherwise — the same batched
  // lookup the map overlays use, so the strip reads "München → Wien" rather
  // than two codes the reader has to decode. NOT `city`: that is OurAirports'
  // municipality, which put "Ferno" on a Malpensa flight (#332). See
  // `utils/airportDisplay.ts` for why the field cannot be repaired in place.
  const codes = [flight.depIata, flight.arrIata].filter((c): c is string => !!c);
  const airports = codes.length ? await getCachedAirports(codes) : new Map();
  const end = (code: string | null): string => {
    if (!code) return "—";
    return airportDisplayName(airports.get(code.toUpperCase())) ?? code;
  };

  // "LH" + "LH2280" reads "LH LH2280" if joined blindly — most stored flight
  // numbers already carry their carrier prefix, so the code is only prepended
  // when it is actually missing.
  const carrier = flight.airlineIata ?? flight.airline;
  const number = flight.flightNumber;
  const secondary =
    number && carrier && !number.toUpperCase().startsWith(carrier.toUpperCase())
      ? `${carrier} ${number}`
      : (number ?? carrier ?? null);

  return {
    domain: "flight",
    id: flight.id,
    detailId: flight.id,
    startsAt,
    tripId: flight.tripId,
    tripName: flight.trip?.name ?? null,
    primary: `${end(flight.depIata)} → ${end(flight.arrIata)}`,
    secondary,
  };
}

async function nextCruise(userId: string): Promise<UpcomingEntry | null> {
  const cruise = await prisma.cruise.findFirst({
    where: { userId, status: { not: "cancelled" }, startDate: { gte: new Date() } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      startDate: true,
      tripId: true,
      cruiseLine: true,
      shipNameOverride: true,
      trip: { select: { name: true } },
      ship: { select: { name: true } },
      departurePort: { select: { name: true } },
    },
  });
  const startsAt = iso(cruise?.startDate ?? null);
  if (!cruise || !startsAt) return null;

  return {
    domain: "cruise",
    id: cruise.id,
    detailId: cruise.id,
    startsAt,
    tripId: cruise.tripId,
    tripName: cruise.trip?.name ?? null,
    primary: cruise.ship?.name ?? cruise.shipNameOverride ?? cruise.cruiseLine ?? "—",
    secondary: cruise.departurePort?.name ?? cruise.cruiseLine ?? null,
  };
}

async function nextStay(userId: string): Promise<UpcomingEntry | null> {
  // Query from the START of the current UTC day, not from `now`: the old
  // `checkIn >= now` filter dropped a stay checking in TODAY the moment
  // midnight passed — the exact stay the banner is most useful for. The JS
  // filter below then applies the time-refined instant.
  //
  // And one day EARLIER than that, because the stored `checkIn` is a day in the
  // hotel's calendar while this filter counts in UTC, and the conversion only
  // happens below (AUD-099). A Los Angeles hotel with a check-in stored on the
  // 1st at 22:30 local begins at 05:30 UTC on the 2nd — so at 02:00 UTC on the
  // 2nd it is still three and a half hours away, and a filter starting at that
  // day's UTC midnight had already dropped it. One day covers every zone: the
  // extremes are UTC-12 and UTC+14, and the eastern side needs no margin
  // because a later stored day sorts in anyway.
  const windowStart = new Date();
  windowStart.setUTCHours(0, 0, 0, 0);
  windowStart.setUTCDate(windowStart.getUTCDate() - 1);
  const stays = await prisma.lodgingStay.findMany({
    where: { userId, status: { not: "cancelled" }, checkIn: { gte: windowStart } },
    orderBy: [{ checkIn: "asc" }, { id: "asc" }],
    // The bound is on CANDIDATES, and the instant filter below discards some of
    // them, so it has to be wider than the one row this function returns —
    // a day of already-started stays must not crowd out the next real one.
    take: 20,
    select: {
      id: true,
      checkIn: true,
      checkInTime: true,
      tripId: true,
      trip: { select: { name: true } },
      lodging: {
        select: { id: true, name: true, city: true, country: true, lat: true, lon: true },
      },
    },
  });

  const now = Date.now();
  const upcoming = stays
    .filter((s): s is (typeof stays)[number] & { checkIn: Date } => s.checkIn !== null)
    .map((s) => ({
      stay: s,
      instant: stayStartsAt({
        checkIn: s.checkIn,
        checkInTime: s.checkInTime,
        lat: s.lodging.lat,
        lon: s.lodging.lon,
      }),
    }))
    .filter((s) => s.instant.getTime() >= now)
    .sort((a, b) => a.instant.getTime() - b.instant.getTime())[0];
  if (!upcoming) return null;

  const { stay, instant } = upcoming;
  return {
    domain: "lodging",
    id: stay.id,
    // The stay's own page does not exist — `/lodging/:id` is the HOUSE, and it
    // lists the stays. So the target is the lodging, not the stay.
    detailId: stay.lodging.id,
    startsAt: instant.toISOString(),
    tripId: stay.tripId,
    tripName: stay.trip?.name ?? null,
    primary: stay.lodging.name,
    secondary: stay.lodging.city ?? stay.lodging.country ?? null,
  };
}

/** The widest a station's day can start before the instant it is read at. */
const DAY_WINDOW_MS = 38 * 60 * 60 * 1000;

/**
 * The next train (spec 2026-09-25-rail-domain). The departure is a real
 * instant — the server read the ticket's clock in the station's zone — so the
 * date rule is the flight's, unchanged. Asked only while rail is VISIBLE — the
 * user's switch and the instance's beta switch together (see the route below).
 *
 * A ride logged date-only (forgejo#132 item 17) is stored at the START of its
 * day, which is not when it leaves: it stays upcoming until that day is over
 * at its station, and says `startsAtPrecision: "day"`, so a countdown counts
 * days and never shows the midnight as a departure time.
 */
async function nextRail(userId: string): Promise<UpcomingEntry | null> {
  const now = new Date();
  const rides = await prisma.railJourney.findMany({
    where: {
      userId,
      status: { not: "cancelled" },
      departureTime: { gte: new Date(now.getTime() - DAY_WINDOW_MS) },
    },
    orderBy: [{ departureTime: "asc" }, { id: "asc" }],
    // Candidates: the day filter below discards started ones, so the bound is
    // wider than the one row returned.
    take: 20,
    select: {
      id: true,
      depStationName: true,
      arrStationName: true,
      trainCategory: true,
      trainNumber: true,
      operator: true,
      departureTime: true,
      depTimezone: true,
      depPrecision: true,
      tripId: true,
      trip: { select: { name: true } },
    },
  });
  const ride = rides.find((r) =>
    endHasClock(r.depPrecision)
      ? r.departureTime.getTime() >= now.getTime()
      : rideEndsAt({
          ...r,
          arrivalTime: null,
          arrTimezone: null,
          arrPrecision: null,
        }).getTime() > now.getTime()
  );
  if (!ride) return null;
  const train = [ride.trainCategory, ride.trainNumber].filter(Boolean).join(" ");
  return {
    domain: "rail",
    id: ride.id,
    detailId: ride.id,
    startsAt: ride.departureTime.toISOString(),
    startsAtPrecision: endHasClock(ride.depPrecision) ? "minute" : "day",
    tripId: ride.tripId,
    tripName: ride.trip?.name ?? null,
    primary: `${ride.depStationName} → ${ride.arrStationName}`,
    secondary: train || ride.operator || null,
  };
}

/**
 * The next rental pickup (spec 2026-10-01-rental-domain-design §8). The pickup
 * is a real instant — the server read the booking's clock in the station's
 * zone — so the countdown is the flight's rule, unchanged.
 */
async function nextRental(userId: string): Promise<UpcomingEntry | null> {
  const rental = await prisma.rentalBooking.findFirst({
    where: { userId, status: { not: "cancelled" }, pickupTime: { gte: new Date() } },
    orderBy: [{ pickupTime: "asc" }, { id: "asc" }],
    select: {
      id: true,
      provider: true,
      pickupStationName: true,
      vehicleClass: true,
      vehicleExample: true,
      pickupTime: true,
      tripId: true,
      trip: { select: { name: true } },
    },
  });
  if (!rental) return null;
  return {
    domain: "rental",
    id: rental.id,
    detailId: rental.id,
    startsAt: rental.pickupTime.toISOString(),
    tripId: rental.tripId,
    tripName: rental.trip?.name ?? null,
    primary: `${rental.provider} · ${rental.pickupStationName}`,
    secondary: rental.vehicleClass ?? rental.vehicleExample ?? null,
  };
}

async function nextTrip(userId: string): Promise<UpcomingEntry | null> {
  const trip = await prisma.trip.findFirst({
    where: { userId, status: { not: "cancelled" }, startDate: { gte: new Date() } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { id: true, name: true, startDate: true, destinationLabel: true },
  });
  const startsAt = iso(trip?.startDate ?? null);
  if (!trip || !startsAt) return null;

  return {
    domain: "trip",
    id: trip.id,
    detailId: trip.id,
    startsAt,
    tripId: trip.id,
    // Not repeated: on a trip entry the name IS the headline.
    tripName: null,
    primary: trip.name,
    secondary: trip.destinationLabel,
  };
}

/**
 * GET /api/v1/upcoming
 *
 * `entries` holds at most one entry per domain, soonest first, and ONLY for
 * domains the user can SEE — switched on by the user AND not hidden by the
 * instance's beta switch (`services/domainVisibility.ts`). A disabled domain
 * must not surface anywhere (CLAUDE.md's domain-gating rule), and enforcing
 * that here means a client cannot forget to: this route used to apply only the
 * user's half and leave the beta half to the client, so a client without that
 * check showed the next train on an instance whose rail is off (forgejo#132
 * item 18). Trips are always considered: a trip is the frame around the
 * others, not a domain of its own.
 */
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    // No settings row is a fresh account, which the schema defaults to
    // flights — `visibleDomainKeys` matches the column default rather than
    // guessing "all".
    const enabled = new Set(await loadVisibleDomains(userId));

    const found = await Promise.all([
      enabled.has("flight") ? nextFlight(userId) : null,
      enabled.has("cruise") ? nextCruise(userId) : null,
      enabled.has("lodging") ? nextStay(userId) : null,
      enabled.has("rail") ? nextRail(userId) : null,
      enabled.has("rental") ? nextRental(userId) : null,
      nextTrip(userId),
    ]);

    const entries = found
      .filter((entry): entry is UpcomingEntry => entry !== null)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    res.json({ success: true, data: { entries } });
  } catch (error) {
    next(error);
  }
});

export default router;
