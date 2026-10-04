import { photonRequest } from "../geo/photon";
import type { PlaceNameGeocoder } from "./placeNameBackfill";

/**
 * The production geocoder of the place-name backfill: Photon, at most one
 * request per `minIntervalMs` (default 1.1 s — Photon's public instance asks
 * for fair use, and a backfill is the opposite of a user waiting).
 *
 * The spacing is enforced HERE, around every request, rather than by the
 * pass: the pass may ask one or two questions per place, and a throttle that
 * counted places would let the second one through early.
 */

const DEFAULT_MIN_INTERVAL_MS = 1_100;
const SEARCH_LIMIT = 10;
/** Wide enough that a dense block (a city-hall square) still lists the place. */
const REVERSE_LIMIT = 20;

export interface ThrottleOptions {
  minIntervalMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** A monotonic millisecond clock; injected for tests. */
  clock?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function throttledPhotonGeocoder(opts: ThrottleOptions = {}): PlaceNameGeocoder {
  const interval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const sleep = opts.sleep ?? realSleep;
  const clock = opts.clock ?? (() => performance.now());
  let last = -Infinity;

  const throttled = async <T>(request: () => Promise<T>): Promise<T> => {
    const wait = last + interval - clock();
    if (wait > 0) await sleep(wait);
    last = clock();
    return request();
  };

  const at = (lat: number, lon: number) => ({ lat: String(lat), lon: String(lon) });

  return {
    searchEnglish: (query, lat, lon) =>
      throttled(() =>
        photonRequest("search", { q: query, ...at(lat, lon), lang: "en" }, SEARCH_LIMIT)
      ),
    reverseDefault: (lat, lon) =>
      throttled(() =>
        photonRequest("reverse", { ...at(lat, lon), lang: "default" }, REVERSE_LIMIT)
      ),
    reverseEnglish: (lat, lon) =>
      throttled(() => photonRequest("reverse", { ...at(lat, lon), lang: "en" }, REVERSE_LIMIT)),
  };
}
