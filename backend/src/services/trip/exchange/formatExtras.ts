import { z } from "zod";

import { lat, lon, portRef } from "./publicHalf";

/**
 * Format version 6 (UAT 2026-11-27): an export and import dropped a ferry's and a cruise's lines,
 * a flight's gate, terminal and flown distance, and every timeline stop that wraps an entry. The
 * keys below carry them. Each is optional, so a file without them is still the lowest version
 * that holds it and an older reader keeps taking it; a file that carries one is version 6.
 */
const opt = (max: number) => z.string().max(max).nullable().optional();
/** `[lon, lat]`, GeoJSON order, as the line columns store it. */
const point = z.tuple([lon, lat]);
/** A stored line may hold more than the wire's 64 points; the file keeps it whole. */
const MAX_LINE_POINTS = 5000;
const line = z.array(point).min(2).max(MAX_LINE_POINTS);

export const FLIGHT_EXTRAS = {
  gate: opt(50),
  terminal: opt(50),
  routeDistance: z.number().min(0).max(50_000).nullable().optional(),
};

export const FERRY_EXTRAS = {
  /** The frozen sea line: drawn (`manual`), routed, or straight. */
  geometry: line.nullable().optional(),
  geometrySource: opt(40),
  manualScope: opt(40),
};

const MAX_LEGS = 200;
export const CRUISE_EXTRAS = {
  /** The computed legs between port calls, as stored (their distance included). */
  legs: z
    .array(
      z
        .object({
          ordinal: z.number().int().min(0).max(1000),
          from: portRef,
          to: portRef,
          distanceKm: z.number().min(0).max(50_000),
          method: z.string().max(40),
          routerVersion: z.string().max(80),
          dataVersion: opt(80),
          confidence: z.string().max(40),
          computedAt: z.iso.datetime({ offset: true }).nullable().optional(),
        })
        .strict()
    )
    .max(MAX_LEGS)
    .optional(),
  /** Lines drawn between two ports (`CruiseLegRoute`). */
  legRoutes: z
    .array(z.object({ from: portRef, to: portRef, waypoints: line }).strict())
    .max(MAX_LEGS)
    .optional(),
};

/** The kinds of entry a timeline stop may wrap, by the stop's `domain`. */
export const STOP_SOURCE_DOMAINS = [
  "flight",
  "lodging",
  "cruise",
  "rail",
  "bus",
  "ferry",
  "rental",
] as const;
export type StopSourceDomain = (typeof STOP_SOURCE_DOMAINS)[number];

export const STOP_EXTRAS = {
  domain: opt(40),
  /** The file key of the entry the stop wraps (its `domain` says which list). */
  sourceKey: z.string().min(1).max(40).nullable().optional(),
};

const has = (v: unknown) => v !== undefined && v !== null;

/** Whether a file uses any of the version-6 keys. */
export function carriesExtras(file: {
  flights?: readonly Record<string, unknown>[];
  ferry?: readonly Record<string, unknown>[];
  cruises?: readonly Record<string, unknown>[];
  stops?: readonly Record<string, unknown>[];
}): boolean {
  const any = (list: readonly Record<string, unknown>[] | undefined, keys: string[]) =>
    (list ?? []).some((e) =>
      keys.some((k) => has(e[k]) && !(Array.isArray(e[k]) && (e[k] as unknown[]).length === 0))
    );
  return (
    any(file.flights, Object.keys(FLIGHT_EXTRAS)) ||
    any(file.ferry, Object.keys(FERRY_EXTRAS)) ||
    any(file.cruises, Object.keys(CRUISE_EXTRAS)) ||
    any(file.stops, Object.keys(STOP_EXTRAS))
  );
}
