/**
 * `GET /stats/flight-insights` (forgejo#256), assembled from the pure folds
 * beside this file over ONE load (`./rows.ts`). The evidence resolvers and the
 * badges call the same folds over the same load, so a figure, the list behind
 * it and the badge it feeds are one computation.
 */

import type { FlightInsights } from "../../../schemas/statsFlightInsights";
import { calculateDistance } from "../../../utils/geo";
import { calculateFunStats } from "../../../utils/stats/funStats";
import type { FlightData } from "../../../utils/stats/types";
import { airportVisits, airportsByYear, longestReunions, quartersByAirportYear } from "./airports";
import { connectionFlights, connectionsByYear } from "./connections";
import { type FlightInsightRow, isCountedRow } from "./rows";
import { buildYearStory, type YearFigures } from "./story";
import { foldTransfers, shortestAndLongest, transfersByYear } from "./transfers";

/** How many airports the "long time no see" list names. */
const REUNION_LIST_LENGTH = 10;

const yearOf = (row: FlightInsightRow): number | null =>
  row.departureDay ? Number(row.departureDay.slice(0, 4)) : null;

function yearFigures(counted: readonly FlightInsightRow[]): YearFigures[] {
  const years = new Map<number, YearFigures>();
  for (const row of counted) {
    const year = yearOf(row);
    if (year === null) continue;
    const prev = years.get(year) ?? { year, flights: 0, distanceKm: 0 };
    years.set(year, {
      year,
      flights: prev.flights + 1,
      distanceKm:
        prev.distanceKm + calculateDistance(row.depLat, row.depLon, row.arrLat, row.arrLon),
    });
  }
  return [...years.values()].sort((a, b) => a.year - b.year);
}

function asFunInput(row: FlightInsightRow): FlightData {
  return {
    id: row.id,
    depTimezone: row.depTimezone,
    depTimeSemantics: row.depTimeSemantics,
    depLat: row.depLat,
    depLon: row.depLon,
    arrLat: row.arrLat,
    arrLon: row.arrLon,
    depIata: row.depIata,
    depIcao: row.depIcao,
    arrIata: row.arrIata,
    arrIcao: row.arrIcao,
    airline: row.airline,
    departureTime: row.departureTime,
    arrivalTime: row.arrivalTime,
    status: row.status,
    seatClass: row.seatClass,
    createdAt: row.createdAt,
  };
}

/**
 * @param requestedYear the story's year; null tells the latest year that has a
 *        counted, dated flight — the data's year, never the wall clock's.
 */
export async function buildFlightInsights(
  rows: readonly FlightInsightRow[],
  requestedYear: number | null
): Promise<FlightInsights> {
  const counted = rows.filter(isCountedRow);
  const visits = airportVisits(rows);
  const airports = airportsByYear(visits);
  const flightsOnConnections = connectionFlights(rows);
  const connections = connectionsByYear(flightsOnConnections);
  const figures = yearFigures(counted);
  const { transfers, coverage } = foldTransfers(rows);
  const transferYears = transfersByYear(transfers);
  const availableYears = figures.map((f) => f.year);
  const storyYear =
    requestedYear !== null
      ? availableYears.includes(requestedYear)
        ? requestedYear
        : null
      : (availableYears[availableYears.length - 1] ?? null);

  const story =
    storyYear === null
      ? null
      : await (async () => {
          const fun = await calculateFunStats(
            counted.filter((row) => yearOf(row) === storyYear).map(asFunInput)
          );
          return buildYearStory({
            year: storyYear,
            availableYears,
            figures,
            airports,
            connections,
            connectionFlights: flightsOnConnections,
            visits,
            transfers: transferYears,
            funFacts: {
              fastestDay: fun.fastestDay,
              fastestDayFlights: fun.fastestDayFlights,
              routeMaster: fun.routeMaster,
              routeMasterCount: fun.routeMasterCount,
              timezones: fun.timezoneHopper,
            },
          });
        })();

  return {
    history: {
      firstYear: availableYears[0] ?? null,
      lastYear: availableYears[availableYears.length - 1] ?? null,
      airportsTotal: new Set(visits.map((v) => v.airport)).size,
      connectionsTotal: new Set(flightsOnConnections.map((f) => f.connection)).size,
      countedFlights: counted.length,
      undatedFlights: counted.filter((row) => row.departureDay === null).length,
      placeholderDateFlights: counted.filter(
        (row) => row.departureDay !== null && (!row.departureDayExact || !row.arrivalDayExact)
      ).length,
      unknownEndFlights: counted.filter((row) => row.depCode === null || row.arrCode === null)
        .length,
    },
    // A year can hold a visit and no departure: a New Year's Eve flight lands
    // in the next one. The table lists every year either side knows.
    years: [...new Set([...availableYears, ...airports.map((a) => a.year)])]
      .sort((a, b) => a - b)
      .map((year) => {
        const f = figures.find((x) => x.year === year) ?? { year, flights: 0, distanceKm: 0 };
        const a = airports.find((x) => x.year === year);
        const c = connections.find((x) => x.year === year);
        const used = a?.used.length ?? 0;
        const discovered = a?.discovered ?? [];
        return {
          year: f.year,
          flights: f.flights,
          distanceKm: Math.round(f.distanceKm),
          airportsUsed: used,
          newAirports: discovered,
          discoveryRate: used > 0 ? discovered.length / used : null,
          connections: (c?.discovered.length ?? 0) + (c?.repeated.length ?? 0),
          newConnections: c?.discovered ?? [],
          repeatedConnections: c?.repeated ?? [],
          flightsOnNewConnections: c?.flightsOnNew ?? 0,
          flightsOnRepeatedConnections: c?.flightsOnRepeated ?? 0,
        };
      }),
    reunions: longestReunions(visits).slice(0, REUNION_LIST_LENGTH),
    quarterAirports: quartersByAirportYear(visits)
      .filter((q) => q.quarters === 4)
      .map(({ airport, year, visits: quarters }) => ({ airport, year, visits: quarters })),
    transfers: { years: transferYears, ...shortestAndLongest(transfers), coverage },
    story,
  };
}
