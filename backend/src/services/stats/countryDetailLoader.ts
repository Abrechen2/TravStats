/**
 * Everything the country drill-down needs from the database, read once.
 *
 * The same split — and the same reason — as `./passportLoader.ts`:
 * `buildCountryDetail` is a pure function so it can be tested against
 * hand-written rows, and this is the file that goes and gets those rows. It
 * moved out of `routes/stats.ts` when the track evidence of spec §8 needed a
 * sixth query, and that route is a 2,500-line file the size ratchet has frozen
 * — so the choice was between a loader beside the one the passport already has,
 * and one more query in the largest file in the repository.
 *
 * Nothing here decides anything. Which house proves a country, which record
 * outranks which, whether a track is a connection — all of that is
 * `services/stats/countryDetail.ts` and `shared/countryEvidence.ts`.
 *
 * The five curated sources are read exactly as `passportLoader` reads them, on
 * purpose: a row and the page behind it must agree, and the only way to
 * guarantee that is to ask the same questions.
 */

import { prisma } from "../../db";
import { countableFlightWhere } from "../../shared/flightCounting";
import { buildCountryDetail, type CountryDetail } from "./countryDetail";
import { loadAirportCountries, loadHomeIatas, passportAirportCodes } from "./passportLoader";

/**
 * @param code the requested country, an ISO alpha-2 code or an English name
 * @returns null when nothing evidences it — the route's 404
 */
export async function loadCountryDetail(
  userId: string,
  code: string
): Promise<CountryDetail | null> {
  const flights = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: {
      id: true,
      flightNumber: true,
      depIata: true,
      depLat: true,
      depLon: true,
      arrIata: true,
      arrLat: true,
      arrLon: true,
      departureTime: true,
      status: true,
    },
  });

  // The same sources the passport counts, so the row and the page can only ever
  // agree.
  const [airportCountries, portCalls, places, lodgings, countryDays, homeIatas] = await Promise.all(
    [
      loadAirportCountries(passportAirportCodes(flights)),
      prisma.cruiseStop.findMany({
        where: {
          cruise: { userId, status: { in: ["flown", "historical"] } },
          port: { isNot: null },
        },
        select: {
          cruiseId: true,
          arrivalTime: true,
          date: true,
          port: { select: { name: true, country: true } },
        },
      }),
      prisma.place.findMany({
        where: { userId, visited: true, isoCountryCode: { not: null } },
        select: {
          id: true,
          name: true,
          isoCountryCode: true,
          visits: { select: { visitedAt: true } },
        },
      }),
      // The fourth source, and the one the owner's instruction is about: a house
      // proves a country, so the page behind that row must be able to open it.
      // `visited: false` is excluded — a bookmarked house is not a visit — and
      // the stays travel UNFILTERED with their status, because `lodgingEvidence`
      // owns which of them count and a house whose only stay was filtered away
      // would arrive as a house with no stay, which counts as a night.
      prisma.lodging.findMany({
        where: { userId, visited: true, isoCountryCode: { not: null } },
        select: {
          id: true,
          name: true,
          isoCountryCode: true,
          stays: { select: { status: true, checkIn: true, checkOut: true } },
        },
      }),
      // The fifth: measured presence (spec §8). Handed over unfiltered like
      // every source above it, so the one place that decides which rows belong
      // to a country is `buildCountryDetail` — narrowing it here would put a
      // second copy of that join in the loader, which is the drift the shared
      // module exists to end. One row per country per day, so the whole set is
      // a few thousand rows even for a decade of history.
      prisma.countryDay.findMany({
        where: { userId },
        select: { date: true, countryCode: true, pointCount: true },
      }),
      loadHomeIatas(userId),
    ]
  );

  return buildCountryDetail(
    code,
    flights,
    airportCountries,
    homeIatas,
    portCalls.map((stop) => ({
      cruiseId: stop.cruiseId,
      portName: stop.port?.name ?? null,
      country: stop.port?.country ?? null,
      at: stop.arrivalTime ?? stop.date,
    })),
    places.flatMap((place) =>
      place.visits.length > 0
        ? place.visits.map((v) => ({
            placeId: place.id,
            name: place.name,
            isoCountryCode: place.isoCountryCode,
            at: v.visitedAt,
          }))
        : [
            {
              placeId: place.id,
              name: place.name,
              isoCountryCode: place.isoCountryCode,
              at: null,
            },
          ]
    ),
    lodgings.map((lodging) => ({
      lodgingId: lodging.id,
      name: lodging.name,
      isoCountryCode: lodging.isoCountryCode,
      stays: lodging.stays,
    })),
    countryDays.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      countryCode: row.countryCode,
      pointCount: row.pointCount,
    }))
  );
}
