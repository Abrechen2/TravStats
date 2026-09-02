/**
 * "Is this position on the grounds of an airport this account actually flew
 * through?" — the §8.2 signal, built from the account's own flights.
 *
 * ## Why the question is asked this way and not with a distance
 *
 * Spec §8.2: *"A GPS point in Doha is still a point in Qatar even if you never
 * left the terminal."* Something has to separate a change of planes from a day
 * in the city, and the obvious candidate — "the points span less than N km" —
 * is exactly the dial §2 refuses on principle. There is no value of N that is
 * right: Monaco is 2 km across and Dallas/Fort Worth is 9, so any threshold
 * calls one of them wrong, and the only way to pick one is to turn it until the
 * total feels good.
 *
 * "Near an airport this traveller flew through" is not a dial. It is a fact
 * assembled from two records this server already holds — a flown flight, and a
 * position — and it answers the actual question rather than a proxy for it.
 * Somebody who never boarded a plane in Qatar cannot have their Qatari days
 * explained away by an airport, however close they parked to one.
 *
 * ## The one number in here, and why it is not a threshold either
 *
 * A radius has to exist, because an airport is a place and not a point. It is
 * fixed at the size of the largest airport GROUNDS rather than tuned: five
 * kilometres from the reference point covers the terminals, aprons and runways
 * of every airport a traveller passes through, and does not reach the middle of
 * a city — Doha's centre is 5 km from DOH's reference point, Frankfurt's 12 km,
 * Amsterdam's 13 km.
 *
 * Where it is wrong it is wrong in the SAFE direction. A perimeter wider than
 * five kilometres (Denver's is about six) leaves an outlying point outside the
 * circle, which reports "not everything was airside" and lifts the country off
 * `connection` onto a higher rung — keeping it in the headline rather than
 * dropping it out. An inferred hint should fail towards visible, and this one
 * does.
 */

import { prisma } from "../../db";
import { countableFlightWhere } from "../../shared/flightCounting";
import { haversineKm } from "../../shared/geo/haversine";
import type { KnownAirportTest } from "./reduce";

/** See the header. Not configurable, and not a threshold to turn. */
const AIRPORT_GROUNDS_RADIUS_KM = 5;

/**
 * Rejected before the trigonometry: a point this far away in latitude alone
 * cannot be within the radius, whatever its longitude. Cheap, exact, and it
 * skips the haversine for all but a handful of the account's airports — which
 * matters, because this predicate runs once per position and a month of
 * location history is tens of thousands of them.
 *
 * One degree of latitude is ~111 km everywhere, so the bound is generous by
 * construction and can never reject a real match.
 */
const LATITUDE_GUARD_DEG = AIRPORT_GROUNDS_RADIUS_KM / 111 + 0.001;

interface AirportPoint {
  lat: number;
  lon: number;
}

/**
 * Build the predicate for one account.
 *
 * Reads BOTH ends of every countable flight: a connection is an arrival
 * followed by a departure, and an account that only ever departed from an
 * airport has still been through it. `countableFlightWhere` is the same cut the
 * passport makes — a booked flight proves nothing, so it cannot explain a
 * position away either.
 *
 * A coordinate pair that is not finite, or that is the (0, 0) placeholder some
 * legacy rows carry, is dropped: a circle in the Gulf of Guinea would silently
 * turn every point on that meridian into a connection.
 */
export async function buildKnownAirportTest(userId: string): Promise<KnownAirportTest> {
  const flights = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: { depLat: true, depLon: true, arrLat: true, arrLon: true },
  });

  const seen = new Set<string>();
  const airports: AirportPoint[] = [];
  const add = (lat: number | null, lon: number | null): void => {
    if (lat === null || lon === null) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (lat === 0 && lon === 0) return;
    const key = `${lat.toFixed(4)} ${lon.toFixed(4)}`;
    if (seen.has(key)) return;
    seen.add(key);
    airports.push({ lat, lon });
  };

  for (const flight of flights) {
    add(flight.depLat, flight.depLon);
    add(flight.arrLat, flight.arrLon);
  }

  return knownAirportTest(airports);
}

/**
 * The pure half, so a test can hand over three airports instead of a database.
 *
 * An empty list answers `false` for everything, which is the honest reading:
 * an account with no flights has no airport that could explain a position, so
 * nothing about its location history is airside.
 */
export function knownAirportTest(airports: readonly AirportPoint[]): KnownAirportTest {
  if (airports.length === 0) return () => false;

  return (lat: number, lon: number): boolean => {
    for (const airport of airports) {
      if (Math.abs(airport.lat - lat) > LATITUDE_GUARD_DEG) continue;
      if (haversineKm({ lat, lon }, airport) <= AIRPORT_GROUNDS_RADIUS_KM) return true;
    }
    return false;
  };
}
