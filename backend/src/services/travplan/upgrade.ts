import { stateSchema } from "./schema";
import type { PlanState } from "./types";

type Raw = Record<string, unknown>;
const isRecord = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * v1 -> v2, additive only: every v1 field is carried over untouched and the
 * route-shape fields start empty, so no stored plan loses a byte. Returns the
 * input itself (same reference) for anything that is not a v1 object.
 */
export function upgradeV1(raw: unknown): unknown {
  if (!isRecord(raw) || raw.version !== 1) return raw;
  const withDefaults = (list: unknown, defaults: Raw) =>
    Array.isArray(list) ? list.map((e) => (isRecord(e) ? { ...defaults, ...e } : e)) : list;
  return {
    ...raw,
    version: 2,
    shape: "stay",
    items: withDefaults(raw.items, { stationId: null }),
    bookings: withDefaults(raw.bookings, { placeholder: false, estimate: null, stageId: null }),
    stations: [],
    stages: [],
    variants: [],
    activeVariantName: "A",
    vehicle: null,
    roadtripId: null,
    stationLinks: [],
    stationWeather: [],
  };
}

/** The one way a stored or incoming plan state is read. */
export function parseState(raw: unknown): PlanState {
  return stateSchema.parse(upgradeV1(raw));
}
