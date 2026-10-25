import { formatLocalDate } from "../../lib/displayFormat";
import { isRealCalendarDay } from "../../lib/importers/lodgingCsv";
import { formatStayPeriod } from "../../lib/lodgingDateDisplay";
import type {
  LodgingDedupeHint,
  LodgingImportFlag,
  LodgingStayChange,
} from "../../types/lodgingImport";
import {
  HEURISTIC_MATCH,
  isEmptyStay,
  priceLacksCurrency,
  type EditableRow,
} from "./lodgingImportRowModel";

/**
 * What a preview row says about itself NOW, after the user's edits.
 *
 * The server's `flags` describe the row as it arrived. The preview used to
 * show them unchanged however the row was edited — a corrected date kept its
 * "Datum ungültig", a date typed wrong after the fact passed the commit gate,
 * and a hotel the user had just matched still said "Keine Koordinaten" about
 * the import's own copy of it (owner, 2026-10-25). Everything the dialog
 * shows or gates on is derived here from the current row, so what the user
 * reads and what the button allows cannot disagree.
 */

/** A blocker that is not a server flag: a price the commit would drop. */
export type RowBlocker = LodgingImportFlag | "missing_currency";

/** Flags that stop a row the user chose to import. The rest inform. */
const BLOCKING: ReadonlySet<LodgingImportFlag> = new Set([
  "missing_name",
  "ambiguous_lodging_name",
  "malformed_date",
  "invalid_date_range",
]);

export function isMatched(row: EditableRow): boolean {
  return row.matchedLodgingId !== null;
}

/** A stay with something in it — a touched-then-cleared one is no stay (`isEmptyStay`). */
export function hasStayData(row: EditableRow): boolean {
  return row.stay !== null && !isEmptyStay(row.stay);
}

/** The match is a guess the user may undo (AUD-056). */
export function isGuessedMatch(row: EditableRow): boolean {
  return isMatched(row) && (row.matchIsGuess ?? HEURISTIC_MATCH.has(row.dedupeHint));
}

/** The import names a house the user still has to pick among `lodgingOptions`. */
export function needsLodgingChoice(row: EditableRow): boolean {
  return (
    !isMatched(row) &&
    row.flags.includes("ambiguous_lodging_name") &&
    row.ambiguityResolved !== true
  );
}

function stayDateFlag(row: EditableRow): LodgingImportFlag | null {
  if (!row.stay || isEmptyStay(row.stay)) return null;
  const { checkIn, checkOut } = row.stay;
  if (!isRealCalendarDay(checkIn) || !isRealCalendarDay(checkOut)) return "malformed_date";
  // ISO days compare as strings.
  return checkOut < checkIn ? "invalid_date_range" : null;
}

/**
 * The flags as they hold for the row as it stands.
 *
 * Hotel-level flags apply only while the row would CREATE a hotel: a matched
 * row never writes its hotel fields (the commit attaches to the stored
 * house), so a missing pin, an unknown chain or an unresolvable name on the
 * import's copy says nothing about what will happen.
 */
export function liveFlags(row: EditableRow): LodgingImportFlag[] {
  const out: LodgingImportFlag[] = [];
  const matched = isMatched(row);
  if (!matched) {
    const name = (row.lodging?.name ?? row.lodgingName ?? "").trim();
    if (!name) out.push("missing_name");
    if (row.lodging === null && row.flags.includes("unresolvable_lodging_name")) {
      out.push("unresolvable_lodging_name");
    }
    if (needsLodgingChoice(row)) out.push("ambiguous_lodging_name");
  }
  const dateFlag = stayDateFlag(row);
  if (dateFlag) out.push(dateFlag);
  if (!matched && row.lodging) {
    if (row.flags.includes("unknown_chain") && row.lodging.chainName) out.push("unknown_chain");
    if (row.lodging.lat == null || row.lodging.lon == null) out.push("missing_coordinates");
  }
  return out;
}

/** What stops this row from being imported as chosen. A skipped or undecided row blocks nothing. */
export function rowBlockers(row: EditableRow): RowBlocker[] {
  if (row.decision !== "create" && row.decision !== "update") return [];
  const blockers: RowBlocker[] = liveFlags(row).filter((f) => BLOCKING.has(f));
  if (priceLacksCurrency(row)) blockers.push("missing_currency");
  return blockers;
}

/** Whether "create" is a choice that would do anything for this row. */
export function canCreate(row: EditableRow): boolean {
  // A matched hotel with no stay: the commit attaches nothing and creates
  // nothing, so offering "create" would offer a no-op.
  return !isMatched(row) || hasStayData(row);
}

export type CreateActionKey =
  "addStay" | "createHotelAndStay" | "createHotel" | "createAnotherStay";

/**
 * What "create" does to THIS row, named for its outcome.
 *
 * One "Anlegen" for every case let the user read "creates a hotel" where the
 * row only adds a stay to a stored one (owner, 2026-10-25).
 */
export function createActionKey(row: EditableRow): CreateActionKey {
  if (isMatched(row)) return row.matchedStayId !== null ? "createAnotherStay" : "addStay";
  // A stays-only row whose name another row of THIS import creates: the
  // server resolved it without a flag, and the commit attaches it there.
  const joinsPayloadHouse =
    row.lodging === null &&
    !row.flags.includes("unresolvable_lodging_name") &&
    !row.flags.includes("ambiguous_lodging_name");
  if (joinsPayloadHouse && hasStayData(row)) return "addStay";
  return hasStayData(row) ? "createHotelAndStay" : "createHotel";
}

/**
 * What the HOUSE match rests on, or null when there is nothing to say.
 * The stay-level hint is `stayHintKey`; a row can carry both.
 */
export function lodgingHintKey(row: EditableRow): LodgingDedupeHint | null {
  if (!isMatched(row)) return null;
  const hint =
    row.lodgingDedupeHint ?? (row.dedupeHint.startsWith("lodging_") ? row.dedupeHint : "none");
  if (hint !== "none") return hint;
  // An older backend set no hint on a stays-only name join.
  return isGuessedMatch(row) ? "lodging_name_only" : null;
}

export function stayHintKey(row: EditableRow): "stay_exact_ref" | "stay_same_dates" | null {
  return row.dedupeHint === "stay_exact_ref" || row.dedupeHint === "stay_same_dates"
    ? row.dedupeHint
    : null;
}

/** The incoming stay's period, written the way the stored one is. */
export function incomingStayLabel(
  row: EditableRow,
  language: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  if (!row.stay || !isRealCalendarDay(row.stay.checkIn) || !isRealCalendarDay(row.stay.checkOut)) {
    return null;
  }
  return formatStayPeriod(
    { checkIn: row.stay.checkIn, checkOut: row.stay.checkOut, datePrecision: "DAY", nights: null },
    language,
    t
  ).label;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 0.005;
  return a === b;
}

/**
 * What a changed booking would move, recomputed against the row as edited.
 *
 * The server's list describes the mail; the user may have corrected a date
 * since. A value the row no longer carries is no change — the server ignores
 * a missing value rather than clear the stored one — and the stored dates are
 * known (`matchedStay`), so an edited check-in or check-out is compared
 * against them, not against the mail.
 */
export function liveChanges(row: EditableRow): LodgingStayChange[] {
  if (!row.stay) return [];
  const stay = row.stay as unknown as Record<string, unknown>;
  const byField = new Map((row.changes ?? []).map((c) => [c.field, c]));
  for (const field of ["checkIn", "checkOut"] as const) {
    const from = row.matchedStay?.[field] ?? byField.get(field)?.from ?? null;
    if (row.matchedStay || byField.has(field)) byField.set(field, { field, from, to: null });
  }
  return [...byField.values()].flatMap((c) => {
    const current = stay[c.field];
    if (current == null || current === "") return [];
    if (sameValue(current, c.from)) return [];
    return [{ ...c, to: current as string | number }];
  });
}

/** One change as a reader writes it: "Abreise: 07.04.2026 → 09.04.2026". */
export function changeLabel(
  change: LodgingStayChange,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const value = (v: string | number | null): string =>
    v == null ? "—" : typeof v === "string" && ISO_DAY.test(v) ? formatLocalDate(v) : String(v);
  return `${t(`lodging:import.changeFields.${change.field}`)}: ${value(change.from)} → ${value(change.to)}`;
}
