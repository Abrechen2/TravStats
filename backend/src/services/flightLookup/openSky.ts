/**
 * OpenSky — the last-resort flight lookup, and the OAuth token cache it needs.
 *
 * Moved out of `flightLookup.ts` unchanged apart from the outcome log
 * (file-size debt): the cascade there calls `lookupOpenSkyFlight` exactly as
 * before.
 */

import { createHash } from "crypto";
import axios from "axios";
import { findOrCreateAirport } from "../airportLookup";
import type { OpenSkyCredentials } from "../apiKeyResolver";
import logger from "../../utils/logger";
import { getAirlineName } from "./fieldReaders";
import { classifyProviderError, type LookupOutcomeLog } from "./providerOutcome";
import type { FlightLookupResult } from "../flightLookup";

/** OpenSky API flight result */
interface OpenSkyFlightResult {
  estDepartureAirport?: string;
  estArrivalAirport?: string;
  firstSeen?: number;
  lastSeen?: number;
  callsign?: string;
}

/**
 * OpenSky OAuth tokens, keyed by the credential that minted them.
 *
 * This used to be a single process-wide slot. A token is bound to ONE OpenSky
 * account, so the first caller's token was then handed to every other user:
 * their lookups ran against a stranger's account and burned that account's
 * quota, and a credential change was ignored until the old token expired
 * (AUD-102).
 *
 * The key is a hash, not the credential — a cache key ends up in heap dumps and
 * debugger views, and a client secret has no business in either. The secret is
 * part of the hash so that rotating it invalidates the entry rather than
 * silently reusing a token minted with the old one.
 */
const openSkyTokenCache = new Map<string, { token: string; expiresAt: number }>();

function openSkyTokenKey(clientId: string, clientSecret: string): string {
  return createHash("sha256")
    .update(`${clientId.length}:${clientId}:${clientSecret}`)
    .digest("hex");
}

/**
 * Resolve OpenSky auth headers (prefers OAuth2 client credentials, falls back to basic)
 */
export async function getOpenSkyAuthHeaders(
  opts: OpenSkyCredentials
): Promise<Record<string, string> | null> {
  // OAuth2 client credentials
  if (opts.clientId && opts.clientSecret) {
    const now = Date.now();
    const cacheKey = openSkyTokenKey(opts.clientId, opts.clientSecret);
    const cached = openSkyTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > now + 30_000) {
      return { Authorization: `Bearer ${cached.token}` };
    }

    try {
      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
      });

      const response = await axios.post(
        "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
        params.toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 5000,
        }
      );

      const token = response.data?.access_token as string | undefined;
      const expiresIn = response.data?.expires_in as number | undefined;
      if (token) {
        const ttl = expiresIn ? expiresIn * 1000 : 30 * 60 * 1000; // default 30min
        openSkyTokenCache.set(cacheKey, { token, expiresAt: Date.now() + ttl });
        return { Authorization: `Bearer ${token}` };
      }
    } catch (err) {
      logger.warn({
        operation: "opensky_token_fetch",
        message: "OpenSky OAuth token fetch failed",
        error: err instanceof Error ? err.message : String(err),
      });
      // fallback to basic if provided
    }
  }

  // Basic auth fallback. The field names are `username`/`password` because that
  // is what `getOpenSkyCredentials` returns; this used to read `user`/`pass`,
  // which are never set, so a fully configured basic credential produced no
  // header and the lookup returned null without ever calling OpenSky
  // (AUD-101). Typing the parameter as `OpenSkyCredentials` is the actual fix:
  // an all-optional inline literal let the mismatch compile.
  if (opts.username && opts.password) {
    const pair = `${opts.username}:${opts.password}`;
    const b64 = Buffer.from(pair).toString("base64");
    return { Authorization: `Basic ${b64}` };
  }

  return null;
}

/**
 * Very lightweight OpenSky fallback (requires optional OPENSKY_USERNAME/PASSWORD)
 * Only works for recent flights and provides limited fields.
 */
export async function lookupOpenSkyFlight(
  flightNumber: string,
  date?: string,
  authHeaders?: Record<string, string>,
  outcomes?: LookupOutcomeLog
): Promise<FlightLookupResult | null> {
  // Credentials exist (the caller checked) but produced no header: the token
  // exchange was refused. That is a key problem, not an unknown flight.
  if (!authHeaders) {
    outcomes?.record("opensky", "auth");
    return null;
  }

  const callsign = flightNumber.toUpperCase();
  // The UTC day of `date` (today without one): OpenSky searches by instant,
  // and midnight of the SERVER's zone made the window depend on the host.
  const day = date ?? new Date().toISOString().slice(0, 10);
  const begin = Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00.000Z`) / 1000);
  const end = begin + 24 * 60 * 60;

  try {
    const url = `https://opensky-network.org/api/flights/callsign?callsign=${callsign}&begin=${begin}&end=${end}`;
    const response = await axios.get(url, { timeout: 6000, headers: authHeaders });
    const result = (response.data as OpenSkyFlightResult[])[0];
    if (!result) {
      outcomes?.record("opensky", "no_match");
      return null;
    }
    outcomes?.record("opensky", "ok");

    const [departureAirport, arrivalAirport] = await Promise.all([
      result.estDepartureAirport
        ? findOrCreateAirport(result.estDepartureAirport)
        : Promise.resolve(null),
      result.estArrivalAirport
        ? findOrCreateAirport(result.estArrivalAirport)
        : Promise.resolve(null),
    ]);

    return {
      airline: getAirlineName(callsign.slice(0, 2)) || undefined,
      flightNumber: callsign.trim(),
      departure: departureAirport || undefined,
      arrival: arrivalAirport || undefined,
      departureTime: result.firstSeen ? new Date(result.firstSeen * 1000).toISOString() : undefined,
      arrivalTime: result.lastSeen ? new Date(result.lastSeen * 1000).toISOString() : undefined,
    };
  } catch (err) {
    logger.warn({
      operation: "opensky_fallback",
      message: "OpenSky fallback failed",
      error: err instanceof Error ? err.message : String(err),
    });
    outcomes?.record("opensky", classifyProviderError(err));
    return null;
  }
}
