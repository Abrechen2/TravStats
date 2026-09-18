/**
 * The pure readers the lookup providers share.
 *
 * Split out of `flightLookup.ts` on 2026-09-15 to bring that file back under
 * its frozen size. They belong together for a better reason than arithmetic:
 * none of them talks to a provider, a database or the clock. Each turns one
 * awkward field — an airline's own date format, a timestamp with no zone
 * marker, a flight number written six ways — into something the adapters can
 * agree on, and each is testable without a network.
 *
 * `flightLookup` re-exports the two public ones, so no caller changed.
 */

import { resolveAirlineCodes } from "../../utils/airlineNormalize";

/**
 * Tag an AirLabs `*_utc` value as UTC.
 *
 * AirLabs returns BOTH a local (`dep_time`) and a UTC (`dep_time_utc`)
 * field, and BOTH in the bare form "YYYY-MM-DD HH:mm" — no `Z`, no offset.
 * `convertAirlabsTimeToUtc` decides by that missing marker and re-interprets
 * the value as airport-local, so preferring `*_utc` silently subtracted the
 * airport's offset a second time (EK51 DXB→MUC 15:55 local / 11:55Z came out
 * as 07:55Z; measured 2026-08-11). Marking the value keeps the converter's
 * existing already-has-a-zone branch, and the local fallback still converts.
 */
export function markUtc(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (/[zZ]$/.test(v) || /[+-]\d{2}:?\d{2}$/.test(v)) return v;
  return `${v.replace(" ", "T")}Z`;
}

/** Absolute day difference between two YYYY-MM-DD strings (positive when a > b). */
export function dayDiff(a: string, b: string): number {
  const aMs = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const bMs = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((aMs - bMs) / (24 * 60 * 60 * 1000));
}

/**
 * Fallback: Try to lookup flight using flight number patterns
 * Extracts airline from flight number (e.g., "LH400" -> "LH")
 */
export function parseFlightNumber(flightNumber: string): {
  airlineCode: string | null;
  flightNum: string | null;
} {
  const match = flightNumber.match(/^([A-Z]{2,3})\s*(\d{1,4})$/i);

  if (match) {
    return {
      airlineCode: match[1].toUpperCase(),
      flightNum: match[2],
    };
  }

  return {
    airlineCode: null,
    flightNum: null,
  };
}

/**
 * Get airline name from IATA code. Resolves via the DB-backed airline
 * catalogue cache (with the curated cold-start fallback baked into
 * `resolveAirlineCodes` for use before the cache is warm) — a superset of
 * the old static 147-entry map, and correct even on a fresh boot.
 */
export function getAirlineName(iataCode: string): string | null {
  if (!iataCode) return null;
  return resolveAirlineCodes(iataCode)?.name ?? null;
}
