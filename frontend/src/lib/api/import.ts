import { api } from "./client";
import type { PreviewRowInput } from "../importers/types";

export interface PreviewRowEnriched extends PreviewRowInput {
  /**
   * ISO-8601 string (serialised from Date on the server).
   * May equal "1970-01-01T00:00:00.000Z" (SAFE_DATE) when the row
   * has hard errors (flags.length > 0) — always check flags before rendering.
   */
  depUtc: string;
  arrUtc: string;
  arrivalLocalCorrected: string;
  depTimezone: string;
  arrTimezone: string;
  depLat: number | null;
  depLon: number | null;
  arrLat: number | null;
  arrLon: number | null;
  flightNumberNormalised?: string;
  statusDefault: "flown" | "scheduled";
  flags: Array<"duration_mismatch" | "unresolvable_airport" | "malformed_datetime" | "missing_required">;
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
