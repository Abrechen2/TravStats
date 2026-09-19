/**
 * What an update would do to the user's numbers.
 *
 * Split out of `pendingUpdateService` on 2026-09-15, which had grown past its
 * frozen size. The seam is not arithmetic: everything else in that file is
 * about the LIFECYCLE of a proposed change — list it, edit it, apply it,
 * reject it, expire it. This answers a different question entirely, and one
 * the caller asks before deciding: if I accept this, what moves?
 *
 * It reads flights and never writes, which is the other half of why it does
 * not belong beside the apply path.
 *
 * `pendingUpdateService` re-exports all three, so no caller changed.
 */

import { Flight, PrismaClient } from "../../prisma";

import { prisma } from "../../db";
import { flightDurationOf } from "../../shared/flightDuration";
import { calculateDistance } from "../../utils/geo";
import { getCachedAirports } from "../airportCache";
import type { FlightDataSnapshot } from "../pendingUpdateService";

const prismaClient = prisma as PrismaClient;

/** A snapshot with the coordinates the distance calculation needs. */
interface FlightDataWithCoords extends FlightDataSnapshot {
  depLat?: number | null;
  depLon?: number | null;
  arrLat?: number | null;
  arrLon?: number | null;
}

export interface StatisticsImpact {
  distance: {
    before: number;
    after: number;
    change: number;
  };
  flightTime: {
    before: number; // minutes
    after: number; // minutes
    change: number; // minutes
  };
  airlines: {
    before: Set<string>;
    after: Set<string>;
    added: string[];
    removed: string[];
  };
  airports: {
    before: Set<string>;
    after: Set<string>;
    added: string[];
    removed: string[];
  };
}

/**
 * Calculate statistics impact of an update
 */
export async function calculateStatisticsImpact(
  flight: Flight,
  originalData: FlightDataSnapshot,
  proposedData: FlightDataSnapshot
): Promise<StatisticsImpact> {
  // Get all user's flown flights for comparison
  const allFlights = await prismaClient.flight.findMany({
    where: {
      userId: flight.userId,
      status: "flown",
    },
  });

  // Get airport coordinates for original and proposed data
  const originalAirportCodes = new Set<string>();
  if (originalData.depIata) originalAirportCodes.add(originalData.depIata);
  if (originalData.depIcao) originalAirportCodes.add(originalData.depIcao);
  if (originalData.arrIata) originalAirportCodes.add(originalData.arrIata);
  if (originalData.arrIcao) originalAirportCodes.add(originalData.arrIcao);

  const proposedAirportCodes = new Set<string>();
  if (proposedData.depIata) proposedAirportCodes.add(proposedData.depIata);
  if (proposedData.depIcao) proposedAirportCodes.add(proposedData.depIcao);
  if (proposedData.arrIata) proposedAirportCodes.add(proposedData.arrIata);
  if (proposedData.arrIcao) proposedAirportCodes.add(proposedData.arrIcao);

  const allCodes = Array.from(new Set([...originalAirportCodes, ...proposedAirportCodes]));
  const airports = await getCachedAirports(allCodes);

  // Build original data with coordinates
  const originalWithCoords = {
    ...originalData,
    depLat: airports.get(originalData.depIata || originalData.depIcao || "")?.lat || flight.depLat,
    depLon: airports.get(originalData.depIata || originalData.depIcao || "")?.lon || flight.depLon,
    arrLat: airports.get(originalData.arrIata || originalData.arrIcao || "")?.lat || flight.arrLat,
    arrLon: airports.get(originalData.arrIata || originalData.arrIcao || "")?.lon || flight.arrLon,
  };

  // Build proposed data with coordinates
  const proposedWithCoords = {
    ...proposedData,
    depLat: airports.get(proposedData.depIata || proposedData.depIcao || "")?.lat || flight.depLat,
    depLon: airports.get(proposedData.depIata || proposedData.depIcao || "")?.lon || flight.depLon,
    arrLat: airports.get(proposedData.arrIata || proposedData.arrIcao || "")?.lat || flight.arrLat,
    arrLon: airports.get(proposedData.arrIata || proposedData.arrIcao || "")?.lon || flight.arrLon,
  };

  // Calculate before stats
  const beforeStats = await calculateUserStats(allFlights, flight, originalWithCoords);

  // Calculate after stats (with proposed data)
  const afterStats = await calculateUserStats(allFlights, flight, proposedWithCoords);

  // Calculate flight time for this specific flight only
  const originalDepTime = originalData.departureTime
    ? new Date(originalData.departureTime)
    : flight.departureTime;
  const originalArrTime = originalData.arrivalTime
    ? new Date(originalData.arrivalTime)
    : flight.arrivalTime;
  const proposedDepTime = proposedData.departureTime
    ? new Date(proposedData.departureTime)
    : flight.departureTime;
  const proposedArrTime = proposedData.arrivalTime
    ? new Date(proposedData.arrivalTime)
    : flight.arrivalTime;

  const originalFlightTime =
    originalArrTime && originalDepTime
      ? Math.round((originalArrTime.getTime() - originalDepTime.getTime()) / (1000 * 60))
      : 0;
  const proposedFlightTime =
    proposedArrTime && proposedDepTime
      ? Math.round((proposedArrTime.getTime() - proposedDepTime.getTime()) / (1000 * 60))
      : 0;

  return {
    distance: {
      before: beforeStats.totalDistance,
      after: afterStats.totalDistance,
      change: afterStats.totalDistance - beforeStats.totalDistance,
    },
    flightTime: {
      before: originalFlightTime,
      after: proposedFlightTime,
      change: proposedFlightTime - originalFlightTime,
    },
    airlines: {
      before: beforeStats.airlines,
      after: afterStats.airlines,
      added: Array.from(afterStats.airlines).filter((a) => !beforeStats.airlines.has(a)),
      removed: Array.from(beforeStats.airlines).filter((a) => !afterStats.airlines.has(a)),
    },
    airports: {
      before: beforeStats.airports,
      after: afterStats.airports,
      added: Array.from(afterStats.airports).filter((a) => !beforeStats.airports.has(a)),
      removed: Array.from(beforeStats.airports).filter((a) => !afterStats.airports.has(a)),
    },
  };
}

/**
 * Calculate user stats with a specific flight data
 */
async function calculateUserStats(
  allFlights: Flight[],
  targetFlight: Flight,
  flightData: FlightDataWithCoords
): Promise<{
  totalDistance: number;
  totalFlightTime: number;
  airlines: Set<string>;
  airports: Set<string>;
}> {
  // Replace target flight with provided data
  const modifiedFlights = allFlights.map((f) => {
    if (f.id === targetFlight.id) {
      return {
        ...f,
        depLat: flightData.depLat ?? f.depLat,
        depLon: flightData.depLon ?? f.depLon,
        arrLat: flightData.arrLat ?? f.arrLat,
        arrLon: flightData.arrLon ?? f.arrLon,
        depIata: flightData.depIata ?? f.depIata,
        depIcao: flightData.depIcao ?? f.depIcao,
        arrIata: flightData.arrIata ?? f.arrIata,
        arrIcao: flightData.arrIcao ?? f.arrIcao,
        airline: flightData.airline ?? f.airline,
        departureTime: flightData.departureTime
          ? new Date(flightData.departureTime)
          : f.departureTime,
        arrivalTime: flightData.arrivalTime ? new Date(flightData.arrivalTime) : f.arrivalTime,
      };
    }
    return f;
  });

  let totalDistance = 0;
  let totalFlightTime = 0;
  const airlines = new Set<string>();
  const airports = new Set<string>();

  for (const f of modifiedFlights) {
    // Distance
    if (f.depLat && f.depLon && f.arrLat && f.arrLon) {
      const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
      totalDistance += dist;
    }

    // Flight time through the shared rule (forgejo#76) — the same number the
    // stats pages report for the row, never a placeholder-clock difference.
    totalFlightTime += flightDurationOf(f)?.minutes ?? 0;

    // Airlines
    if (f.airline) {
      airlines.add(f.airline);
    }

    // Airports
    if (f.depIata) airports.add(f.depIata);
    if (f.depIcao) airports.add(f.depIcao);
    if (f.arrIata) airports.add(f.arrIata);
    if (f.arrIcao) airports.add(f.arrIcao);
  }

  return {
    totalDistance: Math.round(totalDistance),
    totalFlightTime: Math.round(totalFlightTime),
    airlines,
    airports,
  };
}
