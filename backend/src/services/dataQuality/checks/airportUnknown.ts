import type { FlightEnd, RecordSnapshot } from "../recordGather";
import type { DataQualityFinding } from "../types";

/**
 * A flight end whose airport code the catalogue does not know (forgejo#282).
 *
 * An end is unknown when it carries at least one code (IATA or ICAO) and NONE
 * of its codes resolves — a typo ("FRAA"), a retired code, or an airfield the
 * catalogue lacks. An end with a name and no code at all is not asked about:
 * a grass strip has no code to be wrong. Matching is case-insensitive and goes
 * through the same lookup every other reader uses (`getCachedAirports`), so
 * "known" here means "the map, the distances and the zone can find it".
 *
 * Cancelled flights are skipped. The whole check abstains when the catalogue
 * is empty (a fresh instance before its seed): every code would be unknown,
 * and that is a fact about the server, not the user's data.
 */
type Side = "departure" | "arrival";

function unknownEnd(end: FlightEnd, known: ReadonlySet<string>): boolean {
  const codes = [end.iata, end.icao].filter((c): c is string => c !== null);
  return codes.length > 0 && !codes.some((code) => known.has(code.toUpperCase()));
}

export function findUnknownAirports(
  snapshot: Pick<RecordSnapshot, "flights" | "knownAirportCodes" | "airportCatalogueEmpty">
): DataQualityFinding[] {
  if (snapshot.airportCatalogueEmpty) return [];
  const findings: DataQualityFinding[] = [];
  for (const flight of snapshot.flights) {
    if (flight.status === "cancelled") continue;
    const ends: [Side, FlightEnd][] = [
      ["departure", flight.dep],
      ["arrival", flight.arr],
    ];
    const endpoints = ends
      .filter(([, end]) => unknownEnd(end, snapshot.knownAirportCodes))
      .map(([side, end]) => ({ side, iata: end.iata, icao: end.icao, name: end.name }));
    if (endpoints.length === 0) continue;
    findings.push({
      entityType: "flight",
      entityId: flight.id,
      kind: "airport_unknown",
      details: { endpoints },
    });
  }
  return findings;
}
