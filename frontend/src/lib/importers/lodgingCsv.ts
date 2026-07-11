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

export interface LodgingCsvParseResult {
  candidates: LodgingImportCandidate[];
  shape: LodgingCsvShape;
  /** Rows that could not be turned into a candidate at all, with a reason. */
  rowErrors: { rowIndex: number; message: string }[];
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
 * Accepts ISO ("2026-03-30") and unambiguous German dot-format
 * ("30.03.2026") only. A slash-separated date (DD/MM vs MM/DD) is
 * genuinely ambiguous between locales — rather than guess, this returns
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
  const de = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (de) {
    const candidate = `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}`;
    return isRealCalendarDay(candidate) ? candidate : null;
  }
  return null;
}

/** German ("451,70" / "1.234,50") and plain ("451.70") both parse. */
function toNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[^\d.,-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toRating(raw: string): number | null {
  const n = toNumber(raw);
  if (n === null) return null;
  return n >= 1 && n <= 5 ? n : null;
}

const LODGING_TYPES = ["hotel", "campsite", "guesthouse", "apartment", "hostel"] as const;
const BOARD_TYPES = ["none", "breakfast", "half", "full", "all_inclusive"] as const;
const CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

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
  const v = raw.toUpperCase();
  return (CURRENCIES as readonly string[]).includes(v) ? (v as (typeof CURRENCIES)[number]) : null;
}

function buildLodgingFields(
  record: Record<string, string>,
  m: LodgingCsvMapping,
  name: string
): LodgingCandidateFields {
  const placeId = cell(record, m.googlePlaceId);
  const stars = (() => {
    const n = toNumber(cell(record, m.stars));
    return n !== null && n >= 1 && n <= 5 ? Math.round(n) : null;
  })();
  return {
    name,
    type: toLodgingType(cell(record, m.type)),
    chainName: cell(record, m.chainName) || null,
    stars,
    address: cell(record, m.address) || null,
    city: cell(record, m.city) || null,
    country: cell(record, m.country) || null,
    lat: toNumber(cell(record, m.lat)),
    lon: toNumber(cell(record, m.lon)),
    // A Google place id is a PROVEN identity — it is what makes a re-import
    // of the owner's 232-row file a no-op rather than 232 duplicates.
    externalRef: placeId ? `google:${placeId}` : null,
    notes: cell(record, m.notes) || null,
  };
}

function buildStayFields(
  record: Record<string, string>,
  m: LodgingCsvMapping,
  checkIn: string,
  checkOut: string
): StayCandidateFields {
  return {
    checkIn,
    checkOut,
    roomCategory: cell(record, m.roomCategory) || null,
    board: toBoard(cell(record, m.board)),
    // Alex's stays sheet has no price column at all — null here is correct
    // data, and the backend simply writes no FX snapshot for it.
    totalPrice: toNumber(cell(record, m.totalPrice)),
    currency: toCurrency(cell(record, m.currency)),
    ratingRoom: toRating(cell(record, m.ratingRoom)),
    ratingBreakfast: toRating(cell(record, m.ratingBreakfast)),
    ratingOverall: toRating(cell(record, m.ratingOverall)),
    bookingReference: cell(record, m.bookingReference) || null,
    // A CSV row never carries a booking-confirmation externalRef — that only
    // arrives via the email/PDF parser.
    externalRef: null,
    notes: null,
  };
}

export function buildLodgingCandidates(
  records: Record<string, string>[],
  mapping: LodgingCsvMapping
): LodgingCsvParseResult {
  const shape = detectCsvShape(mapping);
  const candidates: LodgingImportCandidate[] = [];
  const rowErrors: { rowIndex: number; message: string }[] = [];

  records.forEach((record, rowIndex) => {
    const name = cell(record, mapping.name);
    if (!name) {
      rowErrors.push({ rowIndex, message: "Row has no hotel name" });
      return;
    }

    let stay: StayCandidateFields | null = null;
    if (shape !== "places") {
      const checkIn = toIsoDay(cell(record, mapping.checkIn));
      const checkOut = toIsoDay(cell(record, mapping.checkOut));
      if (!checkIn || !checkOut) {
        rowErrors.push({
          rowIndex,
          message: "Row has an unreadable check-in/check-out date",
        });
        return;
      }
      stay = buildStayFields(record, mapping, checkIn, checkOut);
    }

    candidates.push({
      sourceRowIndex: rowIndex,
      // In the "stays" shape the file has no lodging columns at all — the row
      // joins an EXISTING lodging by free-text name; the preview resolves it.
      lodging: shape === "stays" ? null : buildLodgingFields(record, mapping, name),
      lodgingName: name,
      stay,
    });
  });

  return { candidates, shape, rowErrors };
}
