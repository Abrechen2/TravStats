/**
 * The best-source resolution of a TravTrack day (owner design 2026-11-24): a
 * Google Timeline import and dense phone tracking overlap on some days, and
 * mixing them drew a zigzag. Each profile-local day is scored per source and
 * drawn, counted and summed from the best one — handing over within the day
 * only where one source clearly starts or stops. Raw points are never altered;
 * every exclusion here is a verdict on the read and can be reversed.
 */

/** A point as the resolution reads it: no motion, no altitude. */
export type SourcePoint = {
  id: string;
  tMs: number;
  lat: number;
  lon: number;
  accuracyM: number | null;
  /** The stored origin: `companion:<device>`, `dawarich:…`, `gpx:<importId>`, … */
  origin: string;
};

export type Window = { fromMs: number; untilMs: number };

/** Which origin is used over `[fromMs, untilMs)`. */
export type SourceSegment = Window & { source: string };

export type SourceSignals = {
  /** Every point of the source on the day. */
  points: number;
  /** Points that are not bad fixes (coarse > 10 km, null island). */
  usable: number;
  /** Usable points per hour of the source's covered span. */
  perHour: number;
  /** Share of points that carry an accuracy at all. */
  accuracyKnownShare: number;
  /** Share of the covered span that lies in gaps longer than `LONG_GAP_MS`. */
  longGapShare: number;
  /** Implausible jumps per step. */
  jumpRate: number;
  /** Share of the day between the source's first and last point. */
  coverage: number;
};

export type SourceScore = { source: string; score: number; signals: SourceSignals };

export type TravelKind = "flight" | "rail" | "bus" | "ferry";

/** A logged journey a jump or a gap may be explained by. */
export type TravelEntry = Window & {
  kind: TravelKind;
  id: string;
  dep: { lat: number; lon: number };
  arr: { lat: number; lon: number };
};

/** A step of the resolved stream a logged entry explains: drawn with the entry's geometry. */
export type Bridge = Window & { kind: TravelKind; entryId: string; reason: "jump" | "gap" };

export type ClockOffset = { source: string; relativeTo: string; offsetS: number };

export type DayResolution = {
  segments: SourceSegment[];
  scores: SourceScore[];
  /** Points left out as an unsupported out-and-back jump. */
  outlierIds: string[];
  /** `[fromMs, untilMs]` steps no line is drawn or counted across: a jump nothing explains. */
  breaks: Array<[number, number]>;
  bridges: Bridge[];
  mixed: boolean;
  bestScore: number;
  clockOffset: ClockOffset | null;
};
