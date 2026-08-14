import { Router, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getCachedAirports } from '../services/airportCache';
import type { DomainKey } from '../shared/domains';

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
  domain: DomainKey | 'trip';
  id: string;
  /** ISO instant this starts — departure, embarkation, check-in, trip start. */
  startsAt: string;
  /** The trip this belongs to, when it has one. Lets the UI link to the trip instead of the item. */
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
    where: { userId, status: { not: 'cancelled' }, departureTime: { gte: new Date() } },
    orderBy: [{ departureTime: 'asc' }, { id: 'asc' }],
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

  // City names where we have them, codes otherwise — the same batched lookup
  // the map overlays use, so the strip reads "München → Wien" rather than two
  // codes the reader has to decode.
  const codes = [flight.depIata, flight.arrIata].filter((c): c is string => !!c);
  const airports = codes.length ? await getCachedAirports(codes) : new Map();
  const end = (code: string | null): string => {
    if (!code) return '—';
    return airports.get(code.toUpperCase())?.city ?? code;
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
    domain: 'flight',
    id: flight.id,
    startsAt,
    tripId: flight.tripId,
    tripName: flight.trip?.name ?? null,
    primary: `${end(flight.depIata)} → ${end(flight.arrIata)}`,
    secondary,
  };
}

async function nextCruise(userId: string): Promise<UpcomingEntry | null> {
  const cruise = await prisma.cruise.findFirst({
    where: { userId, status: { not: 'cancelled' }, startDate: { gte: new Date() } },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
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
    domain: 'cruise',
    id: cruise.id,
    startsAt,
    tripId: cruise.tripId,
    tripName: cruise.trip?.name ?? null,
    primary: cruise.ship?.name ?? cruise.shipNameOverride ?? cruise.cruiseLine ?? '—',
    secondary: cruise.departurePort?.name ?? cruise.cruiseLine ?? null,
  };
}

async function nextStay(userId: string): Promise<UpcomingEntry | null> {
  const stay = await prisma.lodgingStay.findFirst({
    where: { userId, status: { not: 'cancelled' }, checkIn: { gte: new Date() } },
    orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      checkIn: true,
      tripId: true,
      trip: { select: { name: true } },
      lodging: { select: { name: true, city: true, country: true } },
    },
  });
  const startsAt = iso(stay?.checkIn ?? null);
  if (!stay || !startsAt) return null;

  return {
    domain: 'lodging',
    id: stay.id,
    startsAt,
    tripId: stay.tripId,
    tripName: stay.trip?.name ?? null,
    primary: stay.lodging.name,
    secondary: stay.lodging.city ?? stay.lodging.country ?? null,
  };
}

async function nextTrip(userId: string): Promise<UpcomingEntry | null> {
  const trip = await prisma.trip.findFirst({
    where: { userId, status: { not: 'cancelled' }, startDate: { gte: new Date() } },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, startDate: true, destinationLabel: true },
  });
  const startsAt = iso(trip?.startDate ?? null);
  if (!trip || !startsAt) return null;

  return {
    domain: 'trip',
    id: trip.id,
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
 * domains the user has switched on — a disabled domain must not surface
 * anywhere (CLAUDE.md's domain-gating rule), and enforcing that here means a
 * client cannot forget to. Trips are always considered: a trip is the frame
 * around the others, not a domain of its own.
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { enabledDomains: true },
    });
    // No settings row is a fresh account, which the schema defaults to
    // flights — matching the column default rather than guessing "all".
    const enabled = new Set(settings?.enabledDomains ?? ['flight']);

    const found = await Promise.all([
      enabled.has('flight') ? nextFlight(userId) : null,
      enabled.has('cruise') ? nextCruise(userId) : null,
      enabled.has('lodging') ? nextStay(userId) : null,
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
