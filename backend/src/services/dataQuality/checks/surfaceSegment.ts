import { classifySurfaceSegment } from "../../../shared/surfaceSegment";
import type { RecordSnapshot } from "../recordGather";
import type { DataQualityFinding } from "../types";
import { isSetAside } from "./setAside";

/**
 * A stored flight that is a train or a bus ride sold inside a flight booking
 * (owner ruling 2026-11-05, ledger `surface-segments-as-flights`). Older
 * imports read Lufthansa Express Rail and AIRail as flights, so they count in
 * flight kilometres, flight CO2 and the passport's airports.
 *
 * One question per flight, never a silent conversion: `convert` turns the
 * flight into a rail or bus ride, `dismiss` keeps it a flight and the check
 * never asks again. The detection is `shared/surfaceSegment.ts` — equipment,
 * operator, and (only as corroboration) a code that is no airport.
 *
 * A cancelled flight is never asked about, nor a special flight (a sightseeing
 * flight is a flight whatever its equipment text says).
 */
export function findSurfaceSegments(
  snapshot: Pick<RecordSnapshot, "flights" | "knownAirportCodes" | "airportCatalogueEmpty">
): DataQualityFinding[] {
  const out: DataQualityFinding[] = [];
  for (const flight of snapshot.flights) {
    if (isSetAside(flight.status) || flight.specialType !== null) continue;
    const knows = (code: string | null): boolean | null =>
      snapshot.airportCatalogueEmpty || code === null
        ? null
        : snapshot.knownAirportCodes.has(code.toUpperCase());
    const verdict = classifySurfaceSegment({
      aircraft: flight.aircraft,
      airline: flight.airline,
      operatingAirline: flight.operatingAirline,
      departureIsAirport: knows(flight.dep.iata),
      arrivalIsAirport: knows(flight.arr.iata),
    });
    if (!verdict) continue;
    out.push({
      entityType: "flight",
      entityId: flight.id,
      kind: "surface_segment",
      details: {
        flightId: flight.id,
        mode: verdict.mode,
        signals: verdict.signals,
        flightNumber: flight.flightNumber,
        departureCode: flight.dep.iata,
        arrivalCode: flight.arr.iata,
      },
    });
  }
  return out;
}
