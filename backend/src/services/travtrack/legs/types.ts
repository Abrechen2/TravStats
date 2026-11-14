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
  /** The name the owner accepted for this stop (spec "As built — stop places"); null until then. */
  place: StopPlace | null;
  /** Set when the stop is a run of fixes folded into a fixed place or a lodging; null otherwise. */
  folded: { fixCount: number } | null;
  /**
   * Present (`true`) when the owner marked the stop as only a wait
   * (`PUT /travtrack/stops/dismissed`). Absent otherwise, so a client that
   * never heard of it reads every stop as before.
   */
  dismissed?: true;
  /**
   * `true` when the stay began before the day it is shown on (`fromMs` is then the day's start),
   * or ends after it (`untilMs` is the day's end). Absent otherwise. Additive: a client that
   * never heard of it draws the clipped span.
   */
  openStart?: true;
  openEnd?: true;
};

export type StopPlace = {
  name: string;
  /** Where the named place lies; null when the owner named it without a position. */
  lat: number | null;
  lon: number | null;
  source: "accepted" | "fixed" | "lodging";
  /** `FixedPlace.id` of a `fixed` place. */
  placeId?: string;
  /** The `LodgingStay` of a `lodging` place. */
  lodgingStayId?: string;
};

/** A stored acceptance, bound to a span of time. */
export type StopPlaceRow = {
  fromMs: number;
  untilMs: number;
  name: string;
  lat: number | null;
  lon: number | null;
  updatedAtMs: number;
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
