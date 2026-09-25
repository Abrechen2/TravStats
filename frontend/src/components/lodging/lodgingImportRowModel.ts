import { ECB_CURRENCIES, ISO_4217 } from "../../shared/currencies";
import type {
  LodgingDedupeHint,
  LodgingImportMatchedStay,
  LodgingImportPreviewRow,
} from "../../types/lodgingImport";
import { formatStayPeriod, hasUnknownLength, stayNights } from "../../lib/lodgingDateDisplay";

/**
 * The row model the CSV/e-mail import preview edits, and the small helpers
 * that read it.
 *
 * Extracted from `LodgingImportPreviewModal.tsx` on 2026-09-21 when that
 * file crossed the 800-line limit. The modal, its row component and its
 * tests all read the same definitions here, so "what counts as an empty
 * stay" cannot come to mean two things in two files.
 */

/**
 * The row plus the user's in-modal edits. Immutable updates only.
 * `decision` deliberately excludes "needs_input" — the <select> only ever
 * offers "" / "create" / "skip", so a resolved row can never regress back
 * to `needs_input` through the UI.
 */
export interface EditableRow extends LodgingImportPreviewRow {
  /**
   * "" while a needs_input row is still undecided.
   *
   * `update` is offered only for a row the server classified that way — a
   * changed booking under a stored reference (forgejo#122). It is never a
   * choice on any other row: there would be no stay to move.
   */
  decision: "" | "create" | "skip" | "update";
}

export const INPUT =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none";

/**
 * Matches that are GUESSES. A proven identity (an external reference, or a
 * stay reference) is not up for debate; these three are, and the user could
 * accept them or skip the whole row — but not say "no, this is a different
 * house". `create` on such a row carried the guessed id along and attached
 * the stay to the wrong hotel (AUD-056).
 */
export const HEURISTIC_MATCH: ReadonlySet<LodgingDedupeHint> = new Set([
  "lodging_name_city",
  "lodging_name_similar",
  "lodging_nearby",
]);

/**
 * An amount whose unit is not known. The commit refuses to store such a
 * price rather than invent a currency, and reported the row as a success
 * with the price silently gone — because this dialog had a price field and
 * no currency field (AUD-057). The row is held back until the unit is set.
 */
export function priceLacksCurrency(row: EditableRow): boolean {
  return (
    row.decision === "create" &&
    row.stay !== null &&
    (row.stay.totalPrice != null || row.stay.pricePerNight != null) &&
    !row.stay.currency
  );
}

/**
 * Every ISO 4217 code the server accepts, the ECB set first. Offering only the
 * ECB set meant a price in dirham or dinar could be KEPT when the row already
 * carried it, but never CHOSEN when the parser left the unit empty — so the
 * one row the picker exists for could not be completed (AUD-057, 13.09.).
 */
export function currencyOptionGroups(current: string | null | undefined): {
  frequent: readonly string[];
  rest: readonly string[];
} {
  const ecb: readonly string[] = ECB_CURRENCIES;
  const frequent = current && !ecb.includes(current) ? [current, ...ecb] : ecb;
  const rest = Object.keys(ISO_4217)
    .filter((code) => !frequent.includes(code))
    .sort();
  return { frequent, rest };
}

export function toEditableRow(row: LodgingImportPreviewRow): EditableRow {
  return { ...row, decision: row.action === "needs_input" ? "" : row.action };
}

/**
 * How the existing stay is written in the hint: "20.09.2026 – 21.09.2026
 * (1 Nacht)".
 *
 * Through `formatStayPeriod`, the same helper the stay cards use, so the period
 * cannot be written one way on the lodging page and another here — and so a
 * month-precision or undated stay is never printed as a range it does not
 * have. The nights are appended only when the record says: "(0 Nächte)" beside
 * a stay the user is asked to judge would be a measurement nobody took.
 */
export function matchedStayLabel(
  stay: LodgingImportMatchedStay,
  language: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const period = formatStayPeriod(stay, language, t).label;
  return hasUnknownLength(stay)
    ? period
    : `${period} (${t("lodging:field.nightsCount", { count: stayNights(stay) })})`;
}

/** What a changed booking would move, as "field: old → new". */
export function changeSummary(row: EditableRow): string {
  return (row.changes ?? []).map((c) => `${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`).join(", ");
}

/**
 * An UNMATCHED row's lodging/stay fields are editable regardless of which of
 * the "3 real shapes" (spec: types/lodgingImport.ts) the candidate started
 * as — e.g. a stays-only row whose free-text name failed to match
 * (`needs_input`, `unresolvable_lodging_name`) can be turned into a
 * brand-new lodging by filling in its city, which the commit service
 * (`lodgingImportCommit.ts`) happily accepts: it only reads `row.lodging`
 * when `matchedLodgingId` is still unset. These two helpers lazily create
 * the missing half on first edit instead of leaving the field disabled.
 *
 * A MATCHED row (`matchedLodgingId` already set) is the opposite case: the
 * commit service never reads `row.lodging` for it (it attaches a stay to the
 * existing lodging instead), so `PreviewRowLine` renders its name/city as
 * read-only rather than let the user edit a value that would be silently
 * discarded on commit.
 */
export function ensureLodging(row: EditableRow, name: string): NonNullable<EditableRow["lodging"]> {
  return row.lodging ?? { name };
}
export function ensureStay(row: EditableRow): NonNullable<EditableRow["stay"]> {
  return row.stay ?? { checkIn: "", checkOut: "" };
}

/**
 * `ensureStay` above is a one-way door: the first touch of ANY stay input on
 * a stay-less row materializes `stay: {checkIn: "", checkOut: ""}`, and
 * nothing in this UI ever sets `stay` back to `null` — there is no "clear
 * stay" control. If the user touches a stay field and then clears it again
 * (or never fills in real dates), the row would otherwise commit an
 * all-empty stay object that 400s wholesale on the backend's `isoDay` regex.
 * `handleCommit` calls this to fold such a stay back to `null` right before
 * building the payload, so a touch-then-clear on a places-only row is a
 * genuine no-op rather than a dead end.
 */
export function isEmptyStay(stay: NonNullable<EditableRow["stay"]>): boolean {
  return (
    stay.checkIn === "" &&
    stay.checkOut === "" &&
    stay.totalPrice == null &&
    stay.roomCategory == null &&
    stay.board == null &&
    stay.currency == null &&
    stay.ratingRoom == null &&
    stay.ratingBreakfast == null &&
    stay.ratingService == null &&
    stay.ratingOverall == null &&
    stay.bookingReference == null &&
    stay.externalRef == null &&
    stay.notes == null
  );
}

/**
 * Parses the raw string from the total-price `<input type="number">` into a
 * finite number or `null`. `??`/a plain falsy check does not catch `NaN`
 * (`NaN ?? 0` is still `NaN`) — without `Number.isFinite`, a malformed entry
 * would silently store `NaN` and echo "NaN" back into this controlled
 * input. Exported standalone (rather than inlined in the `onChange`) so it
 * can be unit-tested directly: jsdom (and real browsers) sanitize an
 * invalid `type="number"` DOM value to `""` before a change event ever
 * fires, so a DOM-level test cannot actually drive a non-numeric string
 * through `e.target.value`.
 */
export function parseTotalPriceInput(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
