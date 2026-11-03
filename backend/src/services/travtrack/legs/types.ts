/**
 * The leg model of a TravTrack day (spec 2026-11-03-travtrack-legs, §1/§2).
 * The wire shapes are the contract the Companion built against: change them
 * only through the spec.
 */

export const LEG_MODES = [
  "walk",
  "run",
  "cycle",
  "car",
  "bus",
  "train",
  "boat",
  "flight",
  "unknown",
] as const;
export type LegMode = (typeof LEG_MODES)[number];

export type LegModeSource = "auto" | "entry" | "manual";

export type Leg = {
  /** `${fromMs}-${untilMs}`: stable for the same points. */
  id: string;
  fromMs: number;
  untilMs: number;
  mode: LegMode;
  modeSource: LegModeSource;
  /** `auto` only can be `low`; entry and manual are `high`. */
  confidence: "high" | "low";
  entryRef: { domain: string; id: string } | null;
  distanceM: number;
  durationMs: number;
  movingMs: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  ascentM: number | null;
  descentM: number | null;
  /** `[west, south, east, north]` */
  bounds: [number, number, number, number];
  /** Vertex index ranges into the day's `segments`, inclusive. */
  ranges: Array<{ segment: number; from: number; to: number }>;
};

export type Stop = {
  fromMs: number;
  untilMs: number;
  anchor: { lat: number; lon: number };
  stayRef: { id: string; status: string } | null;
};

/** A stored mode correction, bound to a span of time. */
export type LegOverride = {
  fromMs: number;
  untilMs: number;
  mode: LegMode;
  updatedAtMs: number;
};

/** A stay suggestion a stop may point at. */
export type StayCandidate = { id: string; status: string; fromMs: number; untilMs: number };
