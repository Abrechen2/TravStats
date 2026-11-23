import type { EditableRow as LodgingRow } from "../lodging/lodgingImportRowModel";
import {
  canCreate,
  isGuessedMatch,
  liveFlags,
  rowBlockers,
} from "../lodging/lodgingImportRowState";
import { rowHasPosition, type EditableRow as PlaceRow } from "../places/PlaceImportPreviewRow";
import { isRowReady, type RailImportRow } from "../rail/railImportModel";

/**
 * Which rows of an import review are OBVIOUS: the dialog's own model found
 * nothing left to ask. Used by the review bar's "take obviously new rows" and
 * "skip obvious duplicates" — a flagged, guessed, half-placed or blocked row
 * is neither, so neither button can overrule a decision the server declined
 * to make.
 */
export type Obvious = "new" | "duplicate" | null;

/**
 * Place: a row the server wrote as `create` with no flag, no nearby twin and a
 * position is new; one that carries the same external reference as a stored
 * place is a duplicate.
 */
export function placeObvious(row: PlaceRow): Obvious {
  if (row.dedupeHint === "place_exact_ref" && row.action === "skip") return "duplicate";
  if (
    row.action === "create" &&
    row.dedupeHint === "none" &&
    row.flags.length === 0 &&
    rowHasPosition(row)
  ) {
    return "new";
  }
  return null;
}

/**
 * Lodging: new is a server `create` that would import cleanly as it stands —
 * no live flag (an unknown chain is an offer, not obvious), no blocker, no
 * guessed house. A duplicate is a server `skip` whose match is PROVEN (an
 * external or stay reference), never a name or distance guess.
 */
export function lodgingObvious(row: LodgingRow): Obvious {
  if (row.action === "skip" && row.dedupeHint !== "none" && !isGuessedMatch(row)) {
    return "duplicate";
  }
  if (
    row.action === "create" &&
    !isGuessedMatch(row) &&
    canCreate(row) &&
    liveFlags(row).length === 0 &&
    rowBlockers({ ...row, decision: "create" }).length === 0
  ) {
    return "new";
  }
  return null;
}

/**
 * Rail: a leg already in the logbook is a duplicate; a leg with both stations
 * placed that can be saved here is new. A leg waiting for a station is open.
 */
export function railObvious(row: RailImportRow): Obvious {
  if (row.leg.duplicateOf !== null) return "duplicate";
  if (row.saveAs !== null && isRowReady(row)) return "new";
  return null;
}

/** A rail leg the user ticked that still lacks a station position. */
export function railOpen(row: RailImportRow): boolean {
  return row.leg.duplicateOf === null && row.selected && row.saveAs !== null && !isRowReady(row);
}
