/**
 * Trips whose stored country list contradicts their own entries (seen on prod,
 * owner 2026-11-23): a stay, flight or ride lies in a country the list the user
 * typed does not name. The stored list wins everywhere it is shown
 * (`tripCountries`), so a stale one silently hides a country from the trip and
 * from its statistics.
 *
 * Only trips that carry a stored list are read, and every loader takes all of
 * them at once — a fixed number of queries whatever the account holds.
 */
import { prisma } from "../../db";
import { toCountryCode } from "../../shared/countryEvidence";
import {
  airportFactsFor,
  cruiseCountriesByTrip,
  lodgingCountriesByTrip,
  placeCountriesByTrip,
  rideCountriesByTrip,
  roadtripCountriesByTrip,
  tripCountries,
} from "../../routes/trips/tripCountries";

export interface TripCountryMismatch {
  id: string;
  name: string;
  startDate: Date | null;
  /** Countries the trip's entries reach that its stored list leaves out. */
  missing: string[];
}

export async function findTripCountryMismatches(userId: string): Promise<TripCountryMismatch[]> {
  const trips = await prisma.trip.findMany({
    where: { userId, countries: { isEmpty: false } },
    select: {
      id: true,
      name: true,
      startDate: true,
      countries: true,
      flights: { select: { depIata: true, arrIata: true } },
    },
    orderBy: [{ startDate: "desc" }, { id: "asc" }],
  });
  if (trips.length === 0) return [];
  const ids = trips.map((t) => t.id);
  const [facts, cruise, lodging, roadtrip, ride, place] = await Promise.all([
    airportFactsFor(trips.flatMap((t) => t.flights)),
    cruiseCountriesByTrip(ids),
    lodgingCountriesByTrip(ids),
    roadtripCountriesByTrip(ids),
    rideCountriesByTrip(ids),
    placeCountriesByTrip(ids),
  ]);
  const out: TripCountryMismatch[] = [];
  for (const trip of trips) {
    // An empty stored list makes `tripCountries` derive — exactly the entries' own answer.
    const derived = tripCountries(
      [],
      trip.flights,
      facts,
      cruise.get(trip.id) ?? [],
      lodging.get(trip.id) ?? [],
      roadtrip.get(trip.id) ?? [],
      ride.get(trip.id) ?? [],
      place.get(trip.id) ?? []
    );
    const stored = new Set(trip.countries.map((c) => toCountryCode(c) ?? c));
    const missing = derived.filter((c) => !stored.has(c));
    if (missing.length > 0) {
      out.push({ id: trip.id, name: trip.name, startDate: trip.startDate, missing });
    }
  }
  return out;
}

export async function countTripCountryMismatches(userId: string): Promise<number> {
  return (await findTripCountryMismatches(userId)).length;
}
