/**
 * ADS-B community providers — adsb.lol and ADS-B Exchange (forgejo#408).
 *
 * Both speak the readsb "v2" JSON (`{ ac: [{ hex, flight, r, t, lat, lon, … }], now }`),
 * so one adapter serves both; only the base URL and the auth headers differ.
 * They answer "what is in the air right now" and nothing else, which is why they
 * join the lookup chain for today only and never for a date.
 *
 * Every outcome is explicit: `ok`, `no_match`, one failure kind of the existing
 * `providerOutcome` vocabulary, or `disabled` (nothing was requested at all).
 * Nothing here turns a failure into an empty answer.
 */

import axios from "axios";
import NodeCache from "node-cache";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { getApiKey } from "../apiKeyResolver";
import { classifyProviderError, type ProviderFailureKind } from "./providerOutcome";

export type AdsbProvider = "adsbx" | "adsblol";

export type AdsbQuery =
  | { kind: "callsign"; value: string }
  | { kind: "hex"; value: string }
  | { kind: "reg"; value: string };

/** Last known position of an aircraft; every field null when the feeder did not send it. */
export interface AdsbPosition {
  lat: number | null;
  lon: number | null;
  /** Barometric altitude in feet; null on the ground or when unknown. */
  altitudeFt: number | null;
  onGround: boolean;
  groundSpeedKt: number | null;
  trackDeg: number | null;
  /** Seconds since the last message from this aircraft. */
  seenSeconds: number | null;
}

export interface AdsbAircraft {
  /** ICAO24 transponder hex, upper-case. */
  icao24: string | null;
  callsign: string | null;
  registration: string | null;
  /** ICAO aircraft type designator, e.g. "A359". */
  aircraftType: string | null;
  position: AdsbPosition;
}

export type AdsbResult =
  | { status: "ok"; provider: AdsbProvider; aircraft: AdsbAircraft }
  | { status: "no_match"; provider: AdsbProvider }
  | { status: "failed"; provider: AdsbProvider; reason: ProviderFailureKind }
  /** Not configured / switched off: no request was made. */
  | { status: "disabled"; provider: AdsbProvider };

/** Header adsb.lol reads its optional key from. UNVERIFIED against adsb.lol's docs (forgejo#408 Open). */
export const ADSBLOL_KEY_HEADER = "api-auth";
const ADSB_LOL_BASE = "https://api.adsb.lol/v2";
const ADSBX_HOST = "adsbexchange-com1.p.rapidapi.com";
const ADSBX_BASE = `https://${ADSBX_HOST}/v2`;
const TIMEOUT_MS = 6000;
const CACHE_TTL_SECONDS = 60;
/** An aircraft not heard for this long is not "in the air now". */
const STALE_AFTER_SECONDS = 300;

let minIntervalMs = 1000;
/** Test hook: the real spacing (≤ 1 request/s per provider) would make suites slow. */
export function __setAdsbMinIntervalForTests(ms: number): void {
  minIntervalMs = ms;
}

const cache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS, checkperiod: 120, useClones: false });
const lastCallAt = new Map<AdsbProvider, number>();

export function __resetAdsbForTests(): void {
  cache.flushAll();
  lastCallAt.clear();
  minIntervalMs = 1000;
}

/** Serialises requests per provider so an instance never exceeds ~1 request/s. */
async function paceRequests(provider: AdsbProvider): Promise<void> {
  const last = lastCallAt.get(provider) ?? 0;
  const wait = last + minIntervalMs - Date.now();
  // Reserve the slot before sleeping so concurrent callers queue behind each other.
  lastCallAt.set(provider, Math.max(Date.now(), last + minIntervalMs));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export interface AdsbEndpoint {
  provider: AdsbProvider;
  baseUrl: string;
  headers: Record<string, string>;
}

/**
 * Which providers are switched on for this user, in chain order: ADS-B Exchange
 * (keyed) before adsb.lol. No key / switch off = absent from the list.
 */
export async function resolveAdsbEndpoints(userId?: string): Promise<AdsbEndpoint[]> {
  const endpoints: AdsbEndpoint[] = [];

  const adsbxKey = await getApiKey("adsbx", userId);
  if (adsbxKey) {
    endpoints.push({
      provider: "adsbx",
      baseUrl: ADSBX_BASE,
      headers: { "X-RapidAPI-Key": adsbxKey, "X-RapidAPI-Host": ADSBX_HOST },
    });
  }

  // adsb.lol works keyless, so it needs the admin switch; a saved key (user →
  // admin global → ENV) counts as enabling it and is sent on every request.
  const lolKey = await getApiKey("adsblol", userId);
  const admin = lolKey
    ? null
    : await prisma.adminSettings.findFirst({
        orderBy: { id: "asc" },
        select: { adsbLolEnabled: true },
      });
  if (lolKey || admin?.adsbLolEnabled === true) {
    endpoints.push({
      provider: "adsblol",
      baseUrl: ADSB_LOL_BASE,
      headers: lolKey ? { [ADSBLOL_KEY_HEADER]: lolKey } : {},
    });
  }
  return endpoints;
}

interface ReadsbAircraft {
  hex?: unknown;
  flight?: unknown;
  r?: unknown;
  t?: unknown;
  lat?: unknown;
  lon?: unknown;
  alt_baro?: unknown;
  gs?: unknown;
  track?: unknown;
  seen?: unknown;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** readsb v2 record → our shape. Pure; exported for the mapping test. */
export function mapReadsbAircraft(raw: ReadsbAircraft): AdsbAircraft {
  const onGround = raw.alt_baro === "ground";
  const hex = text(raw.hex);
  const callsign = text(raw.flight);
  const registration = text(raw.r);
  const aircraftType = text(raw.t);
  return {
    icao24: hex ? hex.toUpperCase() : null,
    callsign: callsign ? callsign.toUpperCase() : null,
    registration: registration ? registration.toUpperCase() : null,
    aircraftType: aircraftType ? aircraftType.toUpperCase() : null,
    position: {
      lat: finite(raw.lat),
      lon: finite(raw.lon),
      altitudeFt: onGround ? null : finite(raw.alt_baro),
      onGround,
      groundSpeedKt: finite(raw.gs),
      trackDeg: finite(raw.track),
      seenSeconds: finite(raw.seen),
    },
  };
}

function pathFor(query: AdsbQuery): string {
  return `/${query.kind}/${encodeURIComponent(query.value.trim())}`;
}

/** The freshest non-stale aircraft of a v2 body, or null. Throws on a body that is not v2. */
function pickAircraft(body: unknown): AdsbAircraft | null {
  const list = (body as { ac?: unknown } | null | undefined)?.ac;
  if (!Array.isArray(list)) throw new Error("readsb v2 body without an `ac` array");
  const fresh = list
    .map((entry) => mapReadsbAircraft((entry ?? {}) as ReadsbAircraft))
    // An entry that names no aircraft at all is a malformed body, not a hit.
    .filter((a) => a.icao24 || a.callsign || a.registration)
    .filter((a) => (a.position.seenSeconds ?? 0) <= STALE_AFTER_SECONDS)
    .sort((a, b) => (a.position.seenSeconds ?? 0) - (b.position.seenSeconds ?? 0));
  return fresh[0] ?? null;
}

/**
 * One lookup against one endpoint. Answers are cached for 60 s (a failure is
 * not: a revoked key or a 429 must be visible again as soon as it is fixed).
 */
export async function lookupAdsbV2(endpoint: AdsbEndpoint, query: AdsbQuery): Promise<AdsbResult> {
  const { provider } = endpoint;
  const cacheKey = `${provider}:${query.kind}:${query.value.trim().toUpperCase()}`;
  const cached = cache.get<AdsbResult>(cacheKey);
  if (cached) return cached;

  try {
    await paceRequests(provider);
    const response = await axios.get(`${endpoint.baseUrl}${pathFor(query)}`, {
      timeout: TIMEOUT_MS,
      headers: { Accept: "application/json", ...endpoint.headers },
    });
    const aircraft = pickAircraft(response.data);
    const result: AdsbResult = aircraft
      ? { status: "ok", provider, aircraft }
      : { status: "no_match", provider };
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    const reason = classifyProviderError(error);
    logger.warn(
      {
        api: provider,
        operation: "adsb_v2_lookup_failed",
        reason,
        error: error instanceof Error ? error.message : String(error),
      },
      `${provider} lookup failed (${reason})`
    );
    return { status: "failed", provider, reason };
  }
}
