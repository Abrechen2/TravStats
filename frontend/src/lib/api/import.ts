import { api } from "./client";
import type { DetectableFormat, ParserError, PreviewRowInput } from "../importers/types";

export type PreviewFlag =
  "duration_mismatch" | "unresolvable_airport" | "malformed_datetime" | "missing_required";

/**
 * Flags that mean the row CANNOT be imported — the server set depUtc/arrUtc
 * to the SAFE_DATE sentinel (epoch 0) and there is no recovery affordance.
 * Anything not in this list is a soft warning: the row still has valid
 * timestamps and stays selectable.
 */
export const HARD_ERROR_FLAGS = [
  "unresolvable_airport",
  "malformed_datetime",
  "missing_required",
] as const satisfies readonly PreviewFlag[];

export function hasHardError(flags: readonly PreviewFlag[]): boolean {
  return flags.some((f) => (HARD_ERROR_FLAGS as readonly PreviewFlag[]).includes(f));
}

export interface PreviewRowEnriched extends PreviewRowInput {
  /**
   * ISO-8601 string (serialised from Date on the server).
   * Equals "1970-01-01T00:00:00.000Z" (SAFE_DATE) ONLY when `hasHardError(flags)`
   * is true. `duration_mismatch` is a soft warning — depUtc/arrUtc are valid.
   */
  depUtc: string;
  arrUtc: string;
  /** The departure wall clock to store — the row's time, or a date-only placeholder. */
  departureLocal?: string;
  /** Empty when nothing in the file says when the flight arrived. */
  arrivalLocalCorrected: string;
  /** Set for a row without a departure time: how much of the clock is real. */
  timeSemantics?: "DATE_ONLY" | "UNKNOWN";
  depTimezone: string;
  arrTimezone: string;
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
  flightNumberNormalised?: string;
  statusDefault: "flown" | "scheduled" | "historical";
  flags: PreviewFlag[];
  dedupeHint: "exact_match" | "same_day_same_route" | "none";
}

export interface PreviewResponse {
  rows: PreviewRowEnriched[];
  summary: { ok: number; problems: number; duplicates: number; unresolvable: number };
}

export async function postImportPreview(rows: PreviewRowInput[]): Promise<PreviewResponse> {
  const r = await api.post<PreviewResponse>("/import/preview", { rows });
  return r.data;
}

export interface TrackerParseResponse {
  rows: PreviewRowInput[];
  parserErrors: ParserError[];
  /** The format the server read the file as; null when nothing recognised it. */
  format: DetectableFormat | null;
  /** What each format is recognised by — present when `format` is null. */
  expected?: Partial<Record<DetectableFormat, string[]>>;
}

/**
 * Hands another flight tracker's export to the server, which recognises the
 * format and reads it (forgejo#311). The parsers live there alone — five
 * formats mirrored in two trees would be five chances to drift.
 */
export async function parseTrackerExport(content: string): Promise<TrackerParseResponse> {
  const r = await api.post<TrackerParseResponse>("/import/parse", { source: "tracker", content });
  return r.data;
}
