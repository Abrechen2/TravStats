import { lookupOrCreateAirport, type AirportData } from "../airportLookup";

/**
 * Both airports of a provider hit, with the one thing `findOrCreateAirport`'s
 * `null` cannot say: an egress block. A blocked airport is not an unknown one,
 * and the provider adapters report it as its own outcome (`blocked`) instead of
 * returning a hit whose airport silently went missing.
 */
export interface AirportSides {
  departure: AirportData | null;
  arrival: AirportData | null;
  /** At least one airport could not be fetched because outbound access to the airport source is blocked. */
  blocked: boolean;
}

export async function resolveAirportSides(
  departureCode: string | undefined,
  arrivalCode: string | undefined
): Promise<AirportSides> {
  const [dep, arr] = await Promise.all(
    [departureCode, arrivalCode].map(async (code) =>
      code ? lookupOrCreateAirport(code) : ({ status: "not_found" } as const)
    )
  );
  const airportOf = (r: typeof dep) => (r.status === "found" ? r.airport : null);
  const blockedOf = (r: typeof dep) => r.status === "unavailable" && r.reason === "blocked";
  return {
    departure: airportOf(dep),
    arrival: airportOf(arr),
    blocked: blockedOf(dep) || blockedOf(arr),
  };
}
