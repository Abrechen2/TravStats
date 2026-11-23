import rateLimit, { MemoryStore } from "express-rate-limit";
import { RATE_LIMITS } from "../config/constants";
import { userOrIpKey } from "./rateLimit";

/**
 * The flight-lookup bucket, shared: the lookup route spends it per request and the boarding-pass
 * reader per leg it looks up (`consumeFlightLookup`), so a pass full of legs cannot query the
 * providers past the account's own limit.
 */
const flightLookupStore = new MemoryStore();

/**
 * Rate limiter for flight lookup API endpoints
 * Protects external API keys from abuse (AirLabs, OpenSky)
 * Allows 30 lookups per 15 minutes per user.
 *
 * Per USER, not per address: the route sits behind `authenticate`, and a
 * household — or every user behind one reverse proxy — shares one address.
 * Until 2026-09-04 this bucket had no key generator, so one person's lookups
 * blocked everyone else on the same connection (forgejo#68).
 */
export const flightLookupLimiter = rateLimit({
  windowMs: RATE_LIMITS.FLIGHT_LOOKUP_WINDOW_MS,
  max: RATE_LIMITS.FLIGHT_LOOKUP_MAX,
  message: "Too many flight lookup requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  store: flightLookupStore,
});

/**
 * Spends one flight lookup from a bucket. `key` is the route limiter's own key for the request
 * (`userOrIpKey(req)`), so a lookup made while reading a boarding pass draws on exactly the bucket
 * a lookup on the route would. False when the bucket is empty: the caller skips the lookup and
 * says so.
 */
export async function consumeFlightLookup(key: string): Promise<boolean> {
  const { totalHits } = await flightLookupStore.increment(key);
  return totalHits <= RATE_LIMITS.FLIGHT_LOOKUP_MAX;
}

/** Test seam: empties every bucket. */
export function resetFlightLookupBudget(): void {
  void flightLookupStore.resetAll();
}
