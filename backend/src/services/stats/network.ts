/**
 * The flight network: every airport that can be drawn, and every airport pair
 * that has been flown.
 *
 * This exists because a globe cannot be drawn from a top-N list. `/stats/routes`
 * ranks and truncates, `/stats/airports` caps its lists at five and carries no
 * coordinates at all — so the Companion app builds the whole network client-side
 * from the raw flight list, and a web page drawing the same globe would be a
 * second copy of the same arithmetic. Two copies drift, and then one screen
 * shows an arc the other does not.
 *
 * FOUR RULES, each chosen so this endpoint cannot contradict a figure the server
 * already publishes elsewhere:
 *
 * 1. FLOWN ONLY. `flown` + `historical`, the same done-predicate every other
 *    aggregate in `routes/stats.ts` uses. A booked flight is not a line on a map.
 * 2. A ROUTE IS THE UNORDERED PAIR. FRA-WAW and WAW-FRA are ONE route with a
 *    count of two, keyed by the two codes sorted. A globe that ranked directions
 *    would contradict the top-routes list on the same account — and on a
 *    return-trip account it would draw two arcs on top of each other, each
 *    claiming half the traffic.
 * 3. NO NAMES, NO COUNTRIES, NO DATES. Codes, coordinates and counts. Everything
 *    else belongs to the endpoints that already carry it; repeating it here would
 *    double the payload of the one endpoint that returns everything.
 * 4. UNDRAWABLE AIRPORTS ARE OMITTED, never returned with null coordinates —
 *    see `buildFlightNetwork`.
 */

import { calculateDistance } from "../../utils/geo";

/** The columns the derivation reads. Any flight row is a superset. */
export interface NetworkFlight {
  depIata: string | null;
  depIcao: string | null;
  depLat: number;
  depLon: number;
  arrIata: string | null;
  arrIcao: string | null;
  arrLat: number;
  arrLon: number;
  status: string;
}

export interface NetworkAirport {
  /**
   * The airport's IATA code where the catalogue knows one, otherwise whatever
   * code the flight row carried (an ICAO, for a row that has no IATA). Named
   * `iata` because that is what a client renders; it is the node's identity,
   * and the `aIata`/`bIata` of every route refer to it.
   */
  iata: string;
  lat: number;
  lon: number;
  /**
   * Flights that departed from OR landed at this airport — the same way
   * `airportStats` counts a visit, so the busiest node here is the top airport
   * there. A flight that starts and ends at the same airport counts twice, for
   * the same reason it does over there.
   */
  visits: number;
}

export interface NetworkRoute {
  /** The alphabetically smaller of the pair's two codes. See rule 2. */
  aIata: string;
  /** The larger. */
  bIata: string;
  /** Flights on the pair, both directions together. */
  count: number;
  /**
   * Great-circle distance between the two nodes as returned in `airports` —
   * NOT re-measured per flight, so the number always matches the arc a client
   * draws from this very payload.
   */
  distanceKm: number;
}

export interface FlightNetwork {
  airports: NetworkAirport[];
  routes: NetworkRoute[];
}

/** What the airport catalogue can add to a code. `AirportData` is a superset. */
export interface CatalogueAirport {
  iata?: string | null;
  lat: number;
  lon: number;
}

export type AirportCatalogue = ReadonlyMap<string, CatalogueAirport>;

const FLOWN = new Set(["flown", "historical"]);

/**
 * Coordinates that can actually be put on a globe.
 *
 * `dep_lat`/`dep_lon` are NOT NULL in the schema, so a row that was imported
 * without coordinates carries 0/0 rather than nothing. Null Island is in the
 * Gulf of Guinea: drawing it produces an arc that is wrong rather than missing,
 * which is the one outcome this endpoint must never produce.
 */
const usableCoordinates = (lat: number, lon: number): boolean =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180 &&
  !(lat === 0 && lon === 0);

interface Endpoint {
  code: string;
  lat: number;
  lon: number;
}

interface NodeAcc {
  visits: number;
  lat: number | null;
  lon: number | null;
}

/**
 * Resolve one end of a flight to a node identity plus the best coordinates
 * available for it. Returns null when the row does not say WHICH airport this
 * is — an unidentified end can be neither a node nor half of a pair.
 */
function endpointOf(
  iata: string | null,
  icao: string | null,
  lat: number,
  lon: number,
  catalogue: AirportCatalogue
): Endpoint | null {
  const raw = (iata ?? icao)?.trim().toUpperCase();
  if (!raw) return null;

  // The catalogue folds an ICAO-only row onto the same node as its IATA
  // siblings. Without this, an account whose older imports carry only EDDF
  // would grow a second Frankfurt a few metres from the first, and the two
  // would split the visits between them.
  const known = catalogue.get(raw);
  const code = known?.iata?.trim().toUpperCase() || raw;

  // The row's own coordinates first: they are what every other endpoint
  // measures distance with, so using them keeps this payload agreeing with
  // /stats/summary. The catalogue is the fallback for a row that never got
  // any — that recovers a node instead of dropping it.
  if (usableCoordinates(lat, lon)) return { code, lat, lon };
  if (known && usableCoordinates(known.lat, known.lon)) {
    return { code, lat: known.lat, lon: known.lon };
  }
  return { code, lat: NaN, lon: NaN };
}

/**
 * Build the whole network. DELIBERATELY UNBOUNDED — see the endpoint comment in
 * `routes/stats.ts`.
 *
 * An airport with no usable coordinates is LEFT OUT, and so is every route that
 * touches it. It is not returned with null coordinates: a client that has to
 * handle a null node will eventually draw it at 0/0, which is the wrong-arc
 * failure this guards against, and a client that filters it does the same work
 * this function already did. Same trade `buildPassport` makes for an airport
 * whose country the catalogue does not know — left out rather than filed
 * somewhere plausible, because a wrong position cannot be spotted by looking.
 *
 * The cost is that `sum(visits)` can be lower than twice the flight count. That
 * is the honest number for "what can be drawn"; the countable totals live on
 * /stats/summary and /stats/airports, which do not drop anything.
 *
 * @param flights every flight row of ONE user — scoping is the caller's job
 * @param catalogue airport metadata by IATA/ICAO code, for folding codes onto
 *   one node and for filling coordinates a row never had. Optional: an empty
 *   map degrades to row coordinates only, which is what a failed lookup gives.
 */
export function buildFlightNetwork(
  flights: readonly NetworkFlight[],
  catalogue: AirportCatalogue = new Map()
): FlightNetwork {
  const nodes = new Map<string, NodeAcc>();
  const pairs = new Map<string, { a: string; b: string; count: number }>();

  const touch = (endpoint: Endpoint): void => {
    const node = nodes.get(endpoint.code) ?? { visits: 0, lat: null, lon: null };
    // First usable position wins. Enrichment can move a row's coordinates by a
    // few metres between imports; a node that jumps between renders is worse
    // than one that is slightly stale, and picking the first makes the response
    // reproducible for the same data.
    const positioned =
      node.lat === null && usableCoordinates(endpoint.lat, endpoint.lon)
        ? { lat: endpoint.lat, lon: endpoint.lon }
        : { lat: node.lat, lon: node.lon };
    nodes.set(endpoint.code, { visits: node.visits + 1, ...positioned });
  };

  for (const flight of flights) {
    if (!FLOWN.has(flight.status)) continue;

    const dep = endpointOf(flight.depIata, flight.depIcao, flight.depLat, flight.depLon, catalogue);
    const arr = endpointOf(flight.arrIata, flight.arrIcao, flight.arrLat, flight.arrLon, catalogue);

    if (dep) touch(dep);
    if (arr) touch(arr);

    // A leg needs two identified, DIFFERENT ends. A flight that returns to its
    // departure airport (a scenic loop, a diversion back) is a real flight and
    // counts as visits above, but it is not an arc — drawing it would be a
    // zero-length line, and ranking it as a "route" would be a pair with one
    // member.
    if (!dep || !arr || dep.code === arr.code) continue;

    const [a, b] = dep.code < arr.code ? [dep.code, arr.code] : [arr.code, dep.code];
    const key = `${a} ${b}`;
    const existing = pairs.get(key);
    pairs.set(key, { a, b, count: (existing?.count ?? 0) + 1 });
  }

  const drawable = new Map<string, NetworkAirport>();
  for (const [code, node] of nodes) {
    if (node.lat === null || node.lon === null) continue;
    drawable.set(code, { iata: code, lat: node.lat, lon: node.lon, visits: node.visits });
  }

  const airports = [...drawable.values()].sort(
    (x, y) => y.visits - x.visits || x.iata.localeCompare(y.iata)
  );

  const routes: NetworkRoute[] = [];
  for (const pair of pairs.values()) {
    const a = drawable.get(pair.a);
    const b = drawable.get(pair.b);
    if (!a || !b) continue;
    routes.push({
      aIata: pair.a,
      bIata: pair.b,
      count: pair.count,
      distanceKm: Math.round(calculateDistance(a.lat, a.lon, b.lat, b.lon)),
    });
  }
  routes.sort(
    (x, y) => y.count - x.count || x.aIata.localeCompare(y.aIata) || x.bIata.localeCompare(y.bIata)
  );

  return { airports, routes };
}
