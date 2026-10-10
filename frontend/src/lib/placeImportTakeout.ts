// Google Takeout resolution in the place import preview (#358) — the pure half.
//
// The server answers each row with SUGGESTIONS (a position and its source, the
// trip, the visit day from photographs, a kind and a treatment) or the reason
// one is missing. This module folds them into the editable preview rows. The
// rules it keeps:
//
// - nothing a file said is overwritten: a row's own coordinates, address or
//   date win over any lookup;
// - a decision the user (or the exact-reference dedupe) already made is never
//   changed — only an undecided row gets the suggested treatment pre-selected;
// - a same-name place nearby stays undecided: only the user can say whether it
//   is the same place;
// - every suggestion stays visible on the row, so nothing is applied silently.

import { cidFromMapsUrl } from "./mapsExport";
import type {
  DayReason,
  PlaceImportPreviewRow,
  PlaceImportResolution,
  PositionReason,
  TakeoutKind,
  TakeoutTreatment,
} from "../types/placeImport";

/** "" while a row is undecided. */
export type RowDecision = "" | "create" | "skip" | "trip_stop" | "stay";

/** What the resolution said about one row, kept for the row's badges. */
export interface TakeoutRowNote {
  positionSource: "google_cid" | "name_search" | null;
  cidReason: PositionReason | null;
  positionReason: PositionReason | null;
  kind: TakeoutKind;
  suggestedTreatment: TakeoutTreatment;
  /** Photographs behind the suggested day; null when no day came from photos. */
  photoCount: number | null;
  visitDayReason: DayReason | null;
  matchedStayName: string | null;
}

export interface ResolvableRow extends PlaceImportPreviewRow {
  decision: RowDecision;
  takeout?: TakeoutRowNote | null;
}

const hasPosition = (r: { lat?: number | null; lon?: number | null }): boolean =>
  typeof r.lat === "number" &&
  typeof r.lon === "number" &&
  Number.isFinite(r.lat) &&
  Number.isFinite(r.lon);

/** The CID behind a row's reference — `gmaps:<cid>` or a Maps link. */
export function rowCid(externalRef: string | null | undefined): string | null {
  if (!externalRef) return null;
  const prefixed = externalRef.match(/^gmaps:(\d+)$/);
  return prefixed ? prefixed[1] : cidFromMapsUrl(externalRef);
}

/**
 * The rows worth sending to the resolver: not already held, and either
 * unplaced or carrying a Maps identity (whose trip and day are still worth
 * asking about).
 */
export function rowsToResolve<T extends PlaceImportPreviewRow>(rows: readonly T[]): T[] {
  return rows.filter(
    (r) => r.action !== "skip" && (!hasPosition(r) || rowCid(r.externalRef) !== null)
  );
}

/** The decision a suggested treatment pre-selects, where the row allows it. */
function decisionFor(
  treatment: TakeoutTreatment,
  row: { positioned: boolean; tripId: string | null; stayId: string | null }
): RowDecision {
  if (treatment === "skip") return "skip";
  if (treatment === "stay") return row.stayId ? "stay" : "";
  if (!row.positioned) return "";
  if (treatment === "trip_stop") return row.tripId ? "trip_stop" : "create";
  return "create";
}

export function applyResolution<T extends ResolvableRow>(
  rows: readonly T[],
  resolution: PlaceImportResolution
): T[] {
  const byIndex = new Map(resolution.rows.map((r) => [r.sourceRowIndex, r]));
  const tripId = resolution.trip?.id ?? null;

  return rows.map((row) => {
    const answer = byIndex.get(row.sourceRowIndex);
    if (!answer) return row;

    const pos = hasPosition(row) ? null : answer.position;
    const lat = pos ? pos.lat : row.lat;
    const lon = pos ? pos.lon : row.lon;
    const positioned = hasPosition({ lat, lon });
    const ownDate = row.visitedAt?.trim() ? row.visitedAt : null;
    const stayId = answer.matchedStay?.id ?? null;

    const undecided = row.decision === "" && row.dedupeHint !== "place_nearby";
    const decision = undecided
      ? decisionFor(answer.suggestedTreatment, { positioned, tripId, stayId })
      : row.decision;

    return {
      ...row,
      lat,
      lon,
      address: row.address ?? pos?.address ?? null,
      city: row.city ?? pos?.city ?? null,
      country: row.country ?? pos?.country ?? null,
      flags: positioned ? row.flags.filter((f) => f !== "missing_coordinates") : row.flags,
      visitedAt: ownDate ?? answer.visitDay?.date ?? null,
      tripId: row.tripId ?? tripId,
      lodgingStayId: stayId,
      decision,
      takeout: {
        positionSource: pos?.source ?? null,
        cidReason: answer.cidReason,
        positionReason: answer.positionReason,
        kind: answer.kind,
        suggestedTreatment: answer.suggestedTreatment,
        photoCount: ownDate ? null : (answer.visitDay?.photoCount ?? null),
        visitDayReason: ownDate ? null : answer.visitDayReason,
        matchedStayName: answer.matchedStay?.name ?? null,
      },
    };
  });
}

export interface ResolutionSummary {
  google: number;
  byName: number;
  unplaced: number;
  datedFromPhotos: number;
  /** Why rows stayed unplaced, most frequent first. */
  reasons: Array<{ reason: PositionReason; count: number }>;
  /**
   * Google failures, even where the name search then found the row: a refused
   * key or an exhausted quota is worth saying although the row got a pin.
   */
  googleFailures: Array<{ reason: PositionReason; count: number }>;
}

/** CID reasons that are a Google problem, not a property of the row. */
const GOOGLE_FAILURES: ReadonlySet<PositionReason> = new Set([
  "auth",
  "quota",
  "timeout",
  "network",
  "provider_error",
]);

const byCount = <K>(counts: Map<K, number>): Array<{ reason: K; count: number }> =>
  [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

/** The counts the panel above the table states. */
export function summarizeResolution(resolution: PlaceImportResolution): ResolutionSummary {
  const reasons = new Map<PositionReason, number>();
  const googleFailures = new Map<PositionReason, number>();
  let google = 0;
  let byName = 0;
  let unplaced = 0;
  let datedFromPhotos = 0;
  for (const r of resolution.rows) {
    if (r.position?.source === "google_cid") google += 1;
    else if (r.position?.source === "name_search") byName += 1;
    else if (r.positionReason) {
      unplaced += 1;
      reasons.set(r.positionReason, (reasons.get(r.positionReason) ?? 0) + 1);
    }
    if (r.visitDay) datedFromPhotos += 1;
    if (r.cidReason && GOOGLE_FAILURES.has(r.cidReason)) {
      googleFailures.set(r.cidReason, (googleFailures.get(r.cidReason) ?? 0) + 1);
    }
  }
  return {
    google,
    byName,
    unplaced,
    datedFromPhotos,
    reasons: byCount(reasons),
    googleFailures: byCount(googleFailures),
  };
}
