import { formatLocalDate } from "../../lib/displayFormat";
import { isRealCalendarDay } from "../../lib/importers/lodgingCsv";
import { formatStayPeriod } from "../../lib/lodgingDateDisplay";
import { LODGING_IMPORT_LIMITS } from "../../shared/lodgingImportLimits";
import type {
  LodgingDedupeHint,
  LodgingImportFlag,
  LodgingImportStoredStayValues,
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

/**
 * A blocker that is not a server flag: a price the commit would drop, a value
 * the commit schema refuses (`LODGING_IMPORT_LIMITS` — the numbers the backend
 * builds that schema from, so one over-long name cannot 400 the whole batch),
 * or a "create" that would create nothing.
 */
export type LimitBlocker = "name_too_long" | "city_too_long" | "negative_price" | "stay_too_long";
export type RowBlocker =
  LodgingImportFlag | "missing_currency" | LimitBlocker | "nothing_to_create";

/** The number a blocker's copy names, so the message and the rule cannot disagree. */
export const BLOCKER_LIMITS: Readonly<Partial<Record<RowBlocker, number>>> = {
  name_too_long: LODGING_IMPORT_LIMITS.nameMaxLength,
  city_too_long: LODGING_IMPORT_LIMITS.cityMaxLength,
  stay_too_long: LODGING_IMPORT_LIMITS.maxStayNights,
};

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

const DAY_MS = 86_400_000;

/**
 * The commit schema's limits on what the reader can edit. Only these: every
 * other field arrived through the preview request, which the server validated
 * with the same field schema, and the dialog never changes it.
 */
function limitBlockers(row: EditableRow): LimitBlocker[] {
  const L = LODGING_IMPORT_LIMITS;
  const out: LimitBlocker[] = [];
  // Both are sent (`lodgingName` too), and the schema trims before it counts.
  const names = [row.lodging?.name, row.lodgingName];
  if (names.some((n) => (n ?? "").trim().length > L.nameMaxLength)) out.push("name_too_long");
  if ((row.lodging?.city ?? "").length > L.cityMaxLength) out.push("city_too_long");
  const stay = row.stay;
  if (stay && !isEmptyStay(stay)) {
    const prices = [stay.totalPrice, stay.pricePerNight];
    if (prices.some((p) => p != null && p < L.minPrice)) out.push("negative_price");
    if (isRealCalendarDay(stay.checkIn) && isRealCalendarDay(stay.checkOut)) {
      const nights = (Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / DAY_MS;
      if (nights > L.maxStayNights) out.push("stay_too_long");
    }
  }
  return out;
}

/**
 * "Create" on a row that has nothing of its own to create: a stored house, or
 * one another row of this import creates, with the stay cleared away. The
 * payload drops an empty stay, so the commit would write nothing and report
 * nothing (Codex review, 2026-10-25).
 */
function createsNothing(row: EditableRow): boolean {
  return (
    row.decision === "create" && !hasStayData(row) && (isMatched(row) || joinsPayloadHouse(row))
  );
}

/** What stops this row from being imported as chosen. A skipped or undecided row blocks nothing. */
export function rowBlockers(row: EditableRow): RowBlocker[] {
  if (row.decision !== "create" && row.decision !== "update") return [];
  const blockers: RowBlocker[] = liveFlags(row).filter((f) => BLOCKING.has(f));
  if (priceLacksCurrency(row)) blockers.push("missing_currency");
  blockers.push(...limitBlockers(row));
  if (createsNothing(row)) blockers.push("nothing_to_create");
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
  if (joinsPayloadHouse(row) && hasStayData(row)) return "addStay";
  return hasStayData(row) ? "createHotelAndStay" : "createHotel";
}

/**
 * A stays-only row whose name another row of THIS import creates: the server
 * resolved it without a flag, and the commit attaches it there.
 */
function joinsPayloadHouse(row: EditableRow): boolean {
  return (
    !isMatched(row) &&
    row.lodging === null &&
    !row.flags.includes("unresolvable_lodging_name") &&
    !row.flags.includes("ambiguous_lodging_name")
  );
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

type ComparedField = keyof LodgingImportStoredStayValues;

/** Every field `stayChanges` (backend) compares, in its order. Deadlines aside: fill-only, not editable here. */
const COMPARED_FIELDS: readonly ComparedField[] = [
  "checkIn",
  "checkOut",
  "roomCategory",
  "board",
  "guests",
  "totalPrice",
  "pricePerNight",
  "currency",
  "bookingReference",
];

/**
 * The stored values to compare against. An older backend sent none: then the
 * stored dates (`matchedStay`) and the `from` of each change the server listed
 * are all that is known, and a field known nowhere is not compared.
 */
function storedValues(row: EditableRow): Partial<LodgingImportStoredStayValues> {
  if (row.matchedStayValues) return row.matchedStayValues;
  const known: Partial<LodgingImportStoredStayValues> = {};
  for (const c of row.changes ?? []) {
    if ((COMPARED_FIELDS as readonly string[]).includes(c.field)) {
      known[c.field as ComparedField] = c.from;
    }
  }
  if (row.matchedStay) {
    known.checkIn = row.matchedStay.checkIn;
    known.checkOut = row.matchedStay.checkOut;
  }
  return known;
}

/**
 * What a changed booking would move, recomputed against the row as edited.
 *
 * The server's list describes the mail; the user may have corrected a date or
 * typed a price since. Every compared field is held against its STORED value,
 * by the rules the server's `stayChanges` applies at the commit: a value the
 * row does not carry is no change (the server never clears a stored one), a
 * price counts only with its currency, and a currency only beside a price.
 * Deadlines are fill-only and not editable here, so the server's word stands.
 */
export function liveChanges(row: EditableRow): LodgingStayChange[] {
  if (!row.stay) return [];
  const stay = row.stay as unknown as Record<string, unknown>;
  const stored = storedValues(row);
  const hasPrice = row.stay.totalPrice != null || row.stay.pricePerNight != null;
  const compared = COMPARED_FIELDS.flatMap((field): LodgingStayChange[] => {
    if (!(field in stored)) return [];
    const current = stay[field];
    if (current == null || current === "") return [];
    if ((field === "totalPrice" || field === "pricePerNight") && !row.stay?.currency) return [];
    if (field === "currency" && !hasPrice) return [];
    const from = stored[field] ?? null;
    if (sameValue(current, from)) return [];
    return [{ field, from, to: current as string | number }];
  });
  const deadlines = (row.changes ?? []).filter(
    (c) => !(COMPARED_FIELDS as readonly string[]).includes(c.field) && stay[c.field] != null
  );
  return [...compared, ...deadlines];
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
