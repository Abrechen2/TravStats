import { isCurrencyCode } from "../../shared/currencies";
// Lodging CSV importer: field spec, header heuristic, shape detection and
// candidate builder. This is a ONE-TIME MIGRATION TOOL (spec §3.1) — the
// ongoing lodging import path is email/PDF via cruiseBookingParser-style
// extraction. Two real shapes exist in the wild:
//   - a places-only export (hotels, no dates — the owner's 232-row export),
//   - a hotels+stays export (a flat table with both lodging and stay columns,
//     or a stays-only sheet joined against an EXISTING lodging by free-text
//     name — Alex's stays sheet).
// `detectCsvShape` decides which from the CONFIRMED column mapping, and
// `buildLodgingCandidates` turns parsed CSV rows into the same
// `LodgingImportCandidate[]` shape the email/PDF path produces, so preview
// and commit are shared across all three sources.
//
// Pure module: no network, no React, no i18n strings (labels are injected by
// the caller via `buildLodgingMappingFields`'s `label` callback — Task 17).

import type { MappingFieldSpec } from "../../components/import/ColumnMappingWizard";
import type {
  LodgingCandidateFields,
  LodgingImportCandidate,
  StayCandidateFields,
} from "../../types/lodgingImport";
import type { BoardType, LodgingCurrency, LodgingType } from "../../types/lodging";

export const LODGING_CSV_FIELDS = [
  "name",
  "type",
  "chainName",
  "stars",
  "address",
  "city",
  "country",
  "lat",
  "lon",
  "googlePlaceId",
  "checkIn",
  "checkOut",
  "roomCategory",
  "board",
  "totalPrice",
  "currency",
  "ratingRoom",
  "ratingBreakfast",
  "ratingService",
  "ratingOverall",
  "bookingReference",
  "notes",
] as const;
export type LodgingCsvField = (typeof LODGING_CSV_FIELDS)[number];
export type LodgingCsvMapping = Partial<Record<LodgingCsvField, string>>;

/**
 * German first — both real source files (the owner's places export and
 * Alex's stays sheet) are German. Compared by `autoMapHeaders` lower-cased
 * with non-alphanumerics stripped, so "Bew. Frühstück" and "bewfruehstueck"
 * both need an entry here (umlaut and ASCII-transliterated spelling).
 */
export const LODGING_FIELD_ALIASES: Record<LodgingCsvField, string[]> = {
  name: ["name", "hotel", "unterkunft", "hotelname", "lodging", "property"],
  type: ["type", "typ", "art", "kategorie"],
  chainName: ["chain", "kette", "marke", "brand", "hotelkette"],
  stars: ["stars", "sterne", "sternekategorie", "starrating"],
  address: ["address", "adresse", "strasse", "straße", "street"],
  city: ["city", "ort", "stadt", "town"],
  country: ["country", "land", "staat"],
  lat: ["lat", "latitude", "breitengrad"],
  lon: ["lon", "lng", "long", "longitude", "laengengrad", "längengrad"],
  googlePlaceId: ["googleplaceid", "placeid", "googleid", "cid"],
  checkIn: ["checkin", "anreise", "von", "startdate", "arrival"],
  checkOut: ["checkout", "abreise", "bis", "enddate", "departure"],
  roomCategory: ["roomcategory", "zimmer", "zimmerkategorie", "zimmertyp", "roomtype"],
  board: ["board", "verpflegung", "mahlzeiten", "meals"],
  totalPrice: ["totalprice", "preis", "gesamtpreis", "price", "kosten", "betrag"],
  currency: ["currency", "waehrung", "währung"],
  ratingRoom: ["ratingroom", "bewzimmer", "bewertungzimmer", "zimmerbewertung"],
  // Both the ASCII-transliterated ("bewfruehstueck") and the literal-umlaut
  // ("bewfrühstück") spellings are listed even though `normalize()` strips
  // the ü out of both rather than transliterating it — they normalise to
  // DIFFERENT strings ("bewfruehstueck" vs "bewfrhstck"), so both a header
  // spelled out in ASCII and one using the real umlaut need their own entry.
  ratingBreakfast: [
    "ratingbreakfast",
    "bewfruehstueck",
    "bewfrühstück",
    "bewertungfruehstueck",
    "fruehstuecksbewertung",
  ],
  ratingService: [
    "ratingservice",
    "bewservice",
    "bewertungservice",
    "servicebewertung",
    "bewpersonal",
    "bewertungpersonal",
  ],
  ratingOverall: ["ratingoverall", "bewgesamt", "gesamtbewertung", "bewertung"],
  bookingReference: ["bookingreference", "buchungsnummer", "bestaetigungsnummer", "referenz"],
  notes: ["notes", "notiz", "notizen", "bemerkung", "kommentar", "comment"],
};

/** `name` is the only required column: every shape needs something to key on. */
const REQUIRED_FIELDS: LodgingCsvField[] = ["name"];

export function buildLodgingMappingFields(
  label: (field: LodgingCsvField) => string
): MappingFieldSpec<LodgingCsvField>[] {
  return LODGING_CSV_FIELDS.map((field) => ({
    key: field,
    label: label(field),
    required: REQUIRED_FIELDS.includes(field),
    aliases: LODGING_FIELD_ALIASES[field],
  }));
}

const LODGING_ONLY: LodgingCsvField[] = [
  "type",
  "chainName",
  "stars",
  "address",
  "city",
  "country",
  "lat",
  "lon",
  "googlePlaceId",
];
const STAY_ONLY: LodgingCsvField[] = [
  "checkIn",
  "checkOut",
  "roomCategory",
  "board",
  "totalPrice",
  "currency",
  "ratingRoom",
  "ratingBreakfast",
  "ratingService",
  "ratingOverall",
  "bookingReference",
];

export type LodgingCsvShape = "places" | "stays" | "both";

/**
 * Infer from the CONFIRMED mapping what the file holds (spec §3.1):
 * - only lodging fields mapped → places-only (the owner's 232-row export),
 * - only stay fields mapped → stays-only, resolved against an EXISTING
 *   lodging by free-text hotel name at preview time (Alex's stays sheet),
 * - both → a flat table producing a lodging and its stay per row.
 * `name` alone (no lodging-only, no stay-only field mapped) also falls
 * through to "places" — a bare name-only file is still just a places list.
 */
export function detectCsvShape(mapping: LodgingCsvMapping): LodgingCsvShape {
  const hasLodging = LODGING_ONLY.some((f) => !!mapping[f]);
  const hasStay = STAY_ONLY.some((f) => !!mapping[f]);
  if (hasLodging && hasStay) return "both";
  if (hasStay) return "stays";
  return "places";
}

/**
 * Why a row could not be read. A CODE, not prose: the UI translates it and
 * counts it, so "not a single row could be read" can name the actual reason
 * instead of leaving the user to guess which of their columns is wrong.
 * `message` stays alongside for logs and tests — it is never shown as-is.
 */
export type LodgingRowErrorCode = "missing_name" | "unreadable_date" | "unreadable_number";

export interface LodgingRowError {
  rowIndex: number;
  code: LodgingRowErrorCode;
  message: string;
  /** The offending cell verbatim, so the user can spot the format at a glance. */
  sample?: string;
}

export interface LodgingCsvParseResult {
  candidates: LodgingImportCandidate[];
  shape: LodgingCsvShape;
  /** Rows that could not be turned into a candidate at all, with a reason. */
  rowErrors: LodgingRowError[];
}

function cell(record: Record<string, string>, header: string | undefined): string {
  if (!header) return "";
  return (record[header] ?? "").trim();
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar day, checked via a UTC round-trip so the browser's local
 * timezone can never shift the day. "T00:00:00Z" is explicit UTC midnight —
 * `new Date(...).toISOString()` always reports back in UTC regardless of the
 * host's timezone offset, so this never leaks local time into the result
 * (the classic trap: `new Date("2026-03-30")` parsed via a local-aware
 * constructor can print as 2026-03-29 or 2026-03-31 depending on the
 * browser's offset — this path never constructs a Date from a bare string).
 */
function isRealCalendarDay(iso: string): boolean {
  if (!ISO_DATE_RE.test(iso)) return false;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso;
}

/**
 * Expands a two-digit year with the POSIX pivot: 00–69 → 2000s, 70–99 →
 * 1900s. German Excel writes "07.03.26" whenever the source column is
 * formatted "TT.MM.JJ", and rejecting that killed entire stays sheets —
 * every row dropped, no row imported. Two digits are unambiguous ENOUGH
 * for a travel logbook; the alternative was refusing a file whose meaning
 * a human reads at a glance.
 */
function expandTwoDigitYear(yy: string): string {
  const n = Number.parseInt(yy, 10);
  return String(n <= 69 ? 2000 + n : 1900 + n);
}

/**
 * Accepts ISO ("2026-03-30") and unambiguous German dot-format
 * ("30.03.2026", "07.03.26") only. A slash-separated date (DD/MM vs MM/DD)
 * is genuinely ambiguous between locales — rather than guess, this returns
 * null so the row becomes a row error the user is asked about (spec: "a
 * wrong-but-plausible date is worse than one the user is asked about").
 */
function toIsoDay(raw: string): string | null {
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isRealCalendarDay(candidate) ? candidate : null;
  }
  const de = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (de) {
    const year = de[3].length === 2 ? expandTwoDigitYear(de[3]) : de[3];
    const candidate = `${year}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
    return isRealCalendarDay(candidate) ? candidate : null;
  }
  return null;
}

export interface NumericCellResult {
  value: number | null;
  /**
   * True when the cell held non-empty text that could not be parsed as a
   * number at all (e.g. "unbekannt" / "N/A" / "?"). Distinct from a cell
   * that was legitimately empty (`value: null, unparseable: false`) — the
   * caller must surface this as a row error rather than silently coercing
   * it to a fabricated 0 (`Number("") === 0` in JS, which is the trap this
   * type exists to make impossible to ignore).
   */
  unparseable: boolean;
}

/**
 * Parses a numeric cell that may use either German (`"1.234,56"`) or plain /
 * US (`"12,345.67"`) thousands-vs-decimal conventions, without guessing on a
 * genuinely ambiguous format:
 *   - No separator at all → parsed as-is.
 *   - One or more separators present → the LAST separator in the string is
 *     the decimal point, UNLESS it has exactly 3 trailing digits, in which
 *     case there is no decimal part at all and every separator (comma or
 *     dot alike) is a thousands grouping — `"1.234"` and `"1,234"` both →
 *     `1234`, `"1.234.567"` → `1234567`. Any other separator occurring
 *     earlier than the decimal one is likewise treated as a thousands
 *     grouping and dropped, so `"1.234,56"` (German) and `"12,345.67"` /
 *     `"$1,234.50"` (US) all resolve to the correct value regardless of
 *     which character plays which role.
 * A cleaned cell with no digit at all (garbage text survives the
 * non-numeric strip down to `""`) is `unparseable` — this must never
 * return `value: 0` for that case, since `Number("") === 0` in JavaScript.
 */
export function parseNumericCell(raw: string): NumericCellResult {
  if (!raw) return { value: null, unparseable: false };
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(cleaned)) {
    return { value: null, unparseable: true };
  }

  const separatorPositions: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "." || cleaned[i] === ",") separatorPositions.push(i);
  }

  let normalized = cleaned;
  if (separatorPositions.length > 0) {
    const lastPos = separatorPositions[separatorPositions.length - 1];
    const trailingDigits = cleaned.length - lastPos - 1;
    normalized =
      trailingDigits === 3
        ? cleaned.replace(/[.,]/g, "")
        : Array.from(cleaned)
            .map((ch, i) => {
              if (ch !== "." && ch !== ",") return ch;
              return i === lastPos ? "." : "";
            })
            .join("");
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? { value: n, unparseable: false } : { value: null, unparseable: true };
}

function toRating(raw: string): NumericCellResult {
  const parsed = parseNumericCell(raw);
  if (parsed.unparseable) return parsed;
  return {
    value: parsed.value !== null && parsed.value >= 1 && parsed.value <= 5 ? parsed.value : null,
    unparseable: false,
  };
}

const LODGING_TYPES = ["hotel", "campsite", "guesthouse", "apartment", "hostel"] as const;
const BOARD_TYPES = ["none", "breakfast", "half", "full", "all_inclusive"] as const;

function toLodgingType(raw: string): LodgingType | null {
  const v = raw.toLowerCase();
  return (LODGING_TYPES as readonly string[]).includes(v)
    ? (v as (typeof LODGING_TYPES)[number])
    : null;
}

function toBoard(raw: string): BoardType | null {
  const v = raw.toLowerCase();
  return (BOARD_TYPES as readonly string[]).includes(v)
    ? (v as (typeof BOARD_TYPES)[number])
    : null;
}

function toCurrency(raw: string): LodgingCurrency | null {
  // Validated against the whole ISO-4217 registry, not four codes: a sheet in
  // NOK used to arrive here, lose its currency, and take its price down with
  // it (the commit path refuses to invent one).
  const v = raw.toUpperCase();
  return isCurrencyCode(v) ? v : null;
}

/** A row error before it knows which row it belongs to. */
type PendingRowError = Omit<LodgingRowError, "rowIndex">;

interface FieldBuildResult<T> {
  fields: T;
  /**
   * Row-level errors surfaced from mapped numeric cells that held garbage
   * text (e.g. "unbekannt" / "N/A" / "?") — the cell resolves to `null`,
   * never a fabricated 0, and the row is still built; the caller decides
   * whether/how to surface these (never drops the row for them).
   */
  errors: PendingRowError[];
}

function numberError(field: string, sample: string): PendingRowError {
  return { code: "unreadable_number", message: `Row has an unreadable ${field} value`, sample };
}

function buildLodgingFields(
  record: Record<string, string>,
  m: LodgingCsvMapping,
  name: string
): FieldBuildResult<LodgingCandidateFields> {
  const errors: PendingRowError[] = [];
  const placeId = cell(record, m.googlePlaceId);

  const starsCell = parseNumericCell(cell(record, m.stars));
  if (starsCell.unparseable) errors.push(numberError("stars", cell(record, m.stars)));
  const stars =
    starsCell.value !== null && starsCell.value >= 1 && starsCell.value <= 5
      ? Math.round(starsCell.value)
      : null;

  const latCell = parseNumericCell(cell(record, m.lat));
  if (latCell.unparseable) errors.push(numberError("latitude", cell(record, m.lat)));

  const lonCell = parseNumericCell(cell(record, m.lon));
  if (lonCell.unparseable) errors.push(numberError("longitude", cell(record, m.lon)));

  return {
    fields: {
      name,
      type: toLodgingType(cell(record, m.type)),
      chainName: cell(record, m.chainName) || null,
      stars,
      address: cell(record, m.address) || null,
      city: cell(record, m.city) || null,
      country: cell(record, m.country) || null,
      lat: latCell.value,
      lon: lonCell.value,
      // A Google place id is a PROVEN identity — it is what makes a re-import
      // of the owner's 232-row file a no-op rather than 232 duplicates.
      externalRef: placeId ? `google:${placeId}` : null,
      notes: cell(record, m.notes) || null,
    },
    errors,
  };
}

function buildStayFields(
  record: Record<string, string>,
  m: LodgingCsvMapping,
  checkIn: string,
  checkOut: string
): FieldBuildResult<StayCandidateFields> {
  const errors: PendingRowError[] = [];

  const priceCell = parseNumericCell(cell(record, m.totalPrice));
  if (priceCell.unparseable) errors.push(numberError("price", cell(record, m.totalPrice)));

  const ratingRoomCell = toRating(cell(record, m.ratingRoom));
  if (ratingRoomCell.unparseable)
    errors.push(numberError("room rating", cell(record, m.ratingRoom)));

  const ratingBreakfastCell = toRating(cell(record, m.ratingBreakfast));
  if (ratingBreakfastCell.unparseable)
    errors.push(numberError("breakfast rating", cell(record, m.ratingBreakfast)));

  const ratingServiceCell = toRating(cell(record, m.ratingService));
  if (ratingServiceCell.unparseable)
    errors.push(numberError("service rating", cell(record, m.ratingService)));

  const ratingOverallCell = toRating(cell(record, m.ratingOverall));
  if (ratingOverallCell.unparseable)
    errors.push(numberError("overall rating", cell(record, m.ratingOverall)));

  return {
    fields: {
      checkIn,
      checkOut,
      roomCategory: cell(record, m.roomCategory) || null,
      board: toBoard(cell(record, m.board)),
      // Alex's stays sheet has no price column at all — null here is correct
      // data, and the backend simply writes no FX snapshot for it.
      totalPrice: priceCell.value,
      currency: toCurrency(cell(record, m.currency)),
      ratingRoom: ratingRoomCell.value,
      ratingBreakfast: ratingBreakfastCell.value,
      ratingService: ratingServiceCell.value,
      // Passed through as the source gave it — the backend re-derives the
      // overall from the components and only keeps this for a stay that
      // carries none (shared/ratingDerivation.ts).
      ratingOverall: ratingOverallCell.value,
      bookingReference: cell(record, m.bookingReference) || null,
      // A CSV row never carries a booking-confirmation externalRef — that only
      // arrives via the email/PDF parser.
      externalRef: null,
      notes: null,
    },
    errors,
  };
}

export function buildLodgingCandidates(
  records: Record<string, string>[],
  mapping: LodgingCsvMapping
): LodgingCsvParseResult {
  const shape = detectCsvShape(mapping);
  const candidates: LodgingImportCandidate[] = [];
  const rowErrors: LodgingRowError[] = [];

  records.forEach((record, rowIndex) => {
    const name = cell(record, mapping.name);
    if (!name) {
      rowErrors.push({ rowIndex, code: "missing_name", message: "Row has no hotel name" });
      return;
    }

    // Field-level errors (unparseable numeric cells) never drop the row —
    // they're collected here and appended to rowErrors alongside the
    // row-dropping errors above, so one garbage cell surfaces as a warning
    // rather than silently vanishing OR taking the whole row down.
    const fieldErrors: PendingRowError[] = [];

    let stay: StayCandidateFields | null = null;
    if (shape !== "places") {
      const rawCheckIn = cell(record, mapping.checkIn);
      const rawCheckOut = cell(record, mapping.checkOut);
      const checkIn = toIsoDay(rawCheckIn);
      const checkOut = toIsoDay(rawCheckOut);
      if (!checkIn || !checkOut) {
        rowErrors.push({
          rowIndex,
          code: "unreadable_date",
          message: "Row has an unreadable check-in/check-out date",
          // The cell the user has to look at — the FIRST one that failed.
          sample: (checkIn ? rawCheckOut : rawCheckIn) || undefined,
        });
        return;
      }
      const stayResult = buildStayFields(record, mapping, checkIn, checkOut);
      stay = stayResult.fields;
      fieldErrors.push(...stayResult.errors);
    }

    // In the "stays" shape the file has no lodging columns at all — the row
    // joins an EXISTING lodging by free-text name; the preview resolves it.
    let lodging: LodgingCandidateFields | null = null;
    if (shape !== "stays") {
      const lodgingResult = buildLodgingFields(record, mapping, name);
      lodging = lodgingResult.fields;
      fieldErrors.push(...lodgingResult.errors);
    }

    fieldErrors.forEach((error) => rowErrors.push({ rowIndex, ...error }));

    candidates.push({
      sourceRowIndex: rowIndex,
      lodging,
      lodgingName: name,
      stay,
    });
  });

  return { candidates, shape, rowErrors };
}
