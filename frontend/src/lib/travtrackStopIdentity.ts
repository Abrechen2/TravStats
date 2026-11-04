import {
  travTrackLegsApi,
  type TravTrackStop,
  type TravTrackStopIdentity,
} from "./api/travtrackLegs";

/**
 * The lookups of what a stop probably was, kept per stop so the row and the
 * card do not ask twice. Private to the signed-in account: `authStore` empties
 * it on every sign-out, so the next account never reads a previous one's
 * place names or photo-derived suggestions.
 */

const cache = new Map<string, TravTrackStopIdentity>();
const inFlight = new Map<string, Promise<TravTrackStopIdentity>>();
const keyOf = (s: TravTrackStop) => `${s.fromMs}-${s.untilMs}-${s.anchor.lat}-${s.anchor.lon}`;

/** Bumped on every clear: an answer that was asked for before it is not kept after it. */
let generation = 0;

export function clearStopIdentityCache(): void {
  generation += 1;
  cache.clear();
  inFlight.clear();
}

/** One request per stop however many callers ask; only a complete answer is kept. */
export function loadStopIdentity(stop: TravTrackStop): Promise<TravTrackStopIdentity> {
  const key = keyOf(stop);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const asked = generation;
  const promise = travTrackLegsApi
    .stopIdentity(stop)
    .then((identity) => {
      // A degraded answer is not kept: asking again retries.
      if (
        asked === generation &&
        identity.geocoder !== "degraded" &&
        identity.candidatesState !== "degraded"
      ) {
        cache.set(key, identity);
      }
      return identity;
    })
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}
