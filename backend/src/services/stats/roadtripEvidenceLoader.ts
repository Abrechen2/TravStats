/**
 * The roadtrip stations the passport and the country drill-down read, loaded
 * once and already reduced to what `./roadtripEvidence.ts` says they attest.
 *
 * Both callers take the SAME rows from here — a passport row and the page
 * behind it must agree about which station proved a country, and the only way
 * to guarantee that is to ask one loader. The country comes from
 * `stationCountries`, the rule the roadtrip pages and the Stats overview
 * already use (the boundary set first, a linked stay's country on the shore).
 */

import { prisma } from "../../db";
import { getCountryResolver } from "../geo/countryFromCoordinates";
import { stationCountries } from "../roadtrip/roadtripSummary";
import {
  attestStation,
  roadtripHasStarted,
  type PassportRoadtripStation,
} from "./roadtripEvidence";

/** A station that proves a country, with what a drill-down needs to name and link it. */
export interface LoadedRoadtripStation extends PassportRoadtripStation {
  roadtripId: string;
  roadtripName: string;
  stationId: string;
  title: string;
}

export async function loadRoadtripStations(
  userId: string,
  now: Date
): Promise<LoadedRoadtripStation[]> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: {
      id: true,
      name: true,
      stops: {
        select: {
          id: true,
          title: true,
          lat: true,
          lon: true,
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
              lodging: { select: { isoCountryCode: true } },
            },
          },
        },
      },
    },
  });
  // The boundary index is only worth loading for an account that has a
  // roadtrip at all, which is most accounts not.
  if (rows.length === 0) return [];

  const resolver = await getCountryResolver();
  const out: LoadedRoadtripStation[] = [];
  for (const row of rows) {
    // A planned roadtrip counts nowhere — the same cut the overview makes.
    if (!roadtripHasStarted(row.stops, now)) continue;
    for (const stop of row.stops) {
      const attested = attestStation(stop, now);
      if (!attested) continue;
      // Abstains rather than guesses: a station neither its point nor a
      // linked stay can place proves no country.
      const [country] = stationCountries([stop], resolver);
      if (!country) continue;
      out.push({
        ...attested,
        country,
        roadtripId: row.id,
        roadtripName: row.name,
        stationId: stop.id,
        title: stop.title,
      });
    }
  }
  return out;
}
