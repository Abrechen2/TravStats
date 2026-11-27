import { createCustomOsrm } from "./customOsrm";
import type { RouteProvider } from "./types";

/**
 * The public OSRM of FOSSGIS (https://routing.openstreetmap.de), the fallback
 * when an instance has no routing provider. Chosen over the OSRM project demo
 * (router.project-osrm.org, "demonstration only, no production use") because
 * FOSSGIS runs it as a community service: fair use, no bulk requests, and a
 * User-Agent that names the application. openrouteservice has no keyless tier.
 * The `routed-car` instance answers any profile name in the path (measured
 * 2026-11-27: `car` and `driving` return the same route), so the custom OSRM
 * adapter serves it as is; foot and bike would need their own instances, which
 * is why only road legs are routed here.
 */
export const PUBLIC_ROUTING_BASE = "https://routing.openstreetmap.de/routed-car";
export const PUBLIC_ROUTING_HOST = "routing.openstreetmap.de";
/** Names the application, never an account or an address (a fair-use requirement). */
export const PUBLIC_ROUTING_USER_AGENT = "TravStats-self-hosted";
/** One request per 1.1 s for the whole instance, conservatively under FOSSGIS's fair use. */
export const PUBLIC_ROUTING_MIN_INTERVAL_MS = 1100;
const PUBLIC_ROUTING_TIMEOUT_MS = 8_000;

type Sleep = (ms: number) => Promise<void>;
type Clock = () => number;

/**
 * Serialises calls and keeps `minIntervalMs` between their starts. One limiter
 * per process: every account of the instance shares the one public server.
 */
export function createRateLimiter(
  minIntervalMs: number,
  now: Clock = Date.now,
  sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): <T>(run: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;
  return (run) => {
    const result = tail.then(async () => {
      const wait = lastStart + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
      return run();
    });
    tail = result.catch(() => undefined);
    return result;
  };
}

const shared = createRateLimiter(PUBLIC_ROUTING_MIN_INTERVAL_MS);

export function createPublicRouting(
  fetchImpl: typeof fetch = fetch,
  limit: ReturnType<typeof createRateLimiter> = shared
): RouteProvider {
  const limited: typeof fetch = (input, init) =>
    limit(() =>
      fetchImpl(input, {
        ...init,
        // The adapter's own timeout started before the queue; this one starts when the request does.
        signal: AbortSignal.timeout(PUBLIC_ROUTING_TIMEOUT_MS),
        headers: {
          ...(init?.headers as Record<string, string>),
          "User-Agent": PUBLIC_ROUTING_USER_AGENT,
        },
      })
    );
  const osrm = createCustomOsrm(PUBLIC_ROUTING_BASE, limited);
  return {
    ...osrm,
    // Road legs only: the instance is the car profile.
    route: (req) =>
      req.mode === "road" && req.vehicle !== "bicycle" ? osrm.route(req) : Promise.resolve(null),
    healthScope: "public",
  };
}
