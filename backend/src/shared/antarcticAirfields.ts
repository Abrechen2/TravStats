/**
 * Which Antarctic runways belong in the airport catalogue.
 *
 * Antarctica has no large or medium airports because it has no commercial
 * aviation, so OurAirports types nearly every runway there `small_airport`.
 * Wolf's Fang (WFR) is the single exception — which is why "Seven Continents
 * Master" was in practice reachable through exactly one airfield, while the
 * fields tourists actually fly to (Teniente Marsh on King George Island,
 * Union Glacier, Marambio, Rothera, Novolazarevskaya) were invisible.
 *
 * Admitting every `small_airport` worldwide would bury the picker in tens of
 * thousands of airstrips, so this is scoped to the one continent whose
 * reality the type taxonomy does not describe.
 *
 * This lives in `shared/` because the catalogue has TWO write paths — the CLI
 * seed script and the admin re-seed service — and the rule was first written
 * into only one of them. The fix then shipped in three release candidates
 * while the only path a user can trigger still dropped every station. Both
 * paths import from here; neither may keep a copy.
 */
export interface AntarcticCandidate {
  iso_country: string;
  type: string;
  iata_code: string;
  gps_code: string;
}

/**
 * A real code is required. OurAirports gives unaddressable Antarctic features
 * synthetic idents like `AQ-0012` ("Navaid"), and the `ident` fallback both
 * write paths use elsewhere would put those in the picker as if they were
 * codes.
 */
export function isAntarcticAirfield(airport: AntarcticCandidate): boolean {
  return (
    airport.iso_country === 'AQ' &&
    airport.type === 'small_airport' &&
    Boolean(airport.iata_code || airport.gps_code)
  );
}

/** The columns the admission rule reads. A superset of the antarctic check. */
export interface CatalogueCandidate extends AntarcticCandidate {
  ident: string;
  latitude_deg: string;
  longitude_deg: string;
}

/**
 * Does this CSV row belong in the airport catalogue?
 *
 * `closed` is admitted so that permanently closed commercial airports (Berlin
 * Tegel, Denver Stapleton) stay pickable for historical flights — without them
 * a pre-closure flight cannot be logged at all.
 *
 * A code is required either way, so every airport is addressable; `ident` is
 * accepted as the last fallback because closed airports keep their ICAO.
 *
 * @param closedOnly the historical-backfill mode, which stays exactly as
 *   narrow as its name says — no Antarctic widening there.
 */
export function admitsAirport(
  airport: CatalogueCandidate,
  { closedOnly = false }: { closedOnly?: boolean } = {},
): boolean {
  const allowedTypes = closedOnly ? ['closed'] : ['large_airport', 'medium_airport', 'closed'];
  if (!allowedTypes.includes(airport.type) && !(!closedOnly && isAntarcticAirfield(airport))) {
    return false;
  }
  if (!airport.latitude_deg || !airport.longitude_deg) return false;
  if (!airport.iata_code && !airport.gps_code && !airport.ident) return false;
  return true;
}
