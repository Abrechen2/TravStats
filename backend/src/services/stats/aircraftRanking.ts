/**
 * The hull ranking — individual airframes by registration.
 *
 * Extracted from `routes/stats/aircraft.ts` for forgejo#49 so that route and
 * the composed `GET /stats/page` fold the same rows the same way. Unchanged
 * behaviour: a move.
 *
 * The caller decides the population. The endpoint narrows it in the query
 * (`aircraftRegistration: { not: null }`); the composed route filters the rows
 * it already holds, which is the same set because that predicate is a SUBSET
 * of the countable population both start from — see `pageRows.ts`.
 */

import { calculateDistance } from "../../utils/geo";
import type { AircraftRankingItem, AircraftRankingResponse } from "../../schemas/statsAircraft";

/** Everything a hull figure is derived from. */
export interface AircraftRow {
  aircraftRegistration: string | null;
  airline: string | null;
  aircraft: string | null;
  // Non-null in the schema (`Float`, not `Float?`), so a hull always has a
  // distance to add — `calculateDistance` is never handed a missing coordinate.
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  departureTime: Date | null;
}

export function computeAircraftRanking(
  flights: ReadonlyArray<AircraftRow>
): AircraftRankingResponse {
  const buckets = new Map<string, AircraftRankingItem>();
  for (const f of flights) {
    // Only flights carrying a registration appear, so this reflects the
    // AeroDataBox-enriched rows rather than the whole logbook.
    if (!f.aircraftRegistration) continue;
    const reg = f.aircraftRegistration;
    const dist = calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    const isoDate = f.departureTime ? f.departureTime.toISOString() : null;
    const existing = buckets.get(reg);
    if (existing) {
      existing.count += 1;
      existing.totalDistanceKm += dist;
      if (!existing.airline && f.airline) existing.airline = f.airline;
      if (!existing.aircraft && f.aircraft) existing.aircraft = f.aircraft;
      if (isoDate) {
        if (!existing.firstFlightDate || isoDate < existing.firstFlightDate) {
          existing.firstFlightDate = isoDate;
        }
        if (!existing.lastFlightDate || isoDate > existing.lastFlightDate) {
          existing.lastFlightDate = isoDate;
        }
      }
    } else {
      buckets.set(reg, {
        registration: reg,
        count: 1,
        airline: f.airline ?? null,
        aircraft: f.aircraft ?? null,
        totalDistanceKm: dist,
        firstFlightDate: isoDate,
        lastFlightDate: isoDate,
      });
    }
  }

  const aircraft = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  return { aircraft, total: aircraft.length };
}
