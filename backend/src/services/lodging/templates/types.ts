import type { ParsedLodgingBooking } from "../bookingComTemplate";

/**
 * A declarative reader for one lodging sender.
 *
 * This is the lodging half of the template envelope in
 * `docs/superpowers/plans/2026-09-17-parser-templates-all-domains.md` §3,
 * built in code first on purpose: the shape has to survive contact with four
 * real senders before it is frozen as a JSON schema other people write
 * against. Everything here serialises 1:1 — a pattern is a string, a
 * transform is a name — so the migration to the GitHub-synced registry is a
 * format change, not a rewrite.
 *
 * What it deliberately is NOT: a way to express `bookingComTemplate.ts`. That
 * reader does address segmentation, two layouts and currency grammar, and
 * expressing it declaratively would mean inventing a programming language in
 * JSON (plan §5). This shape reads senders whose confirmations are regular —
 * label, value, one line — which is most of them.
 */
export interface LodgingTemplate {
  /** Stable id, `lodging:<issuer>`. Becomes the registry key. */
  id: string;
  /** What to call the reader in logs and in `parserTemplate`. */
  name: string;
  /**
   * Every marker must appear in the document (subject + body), and at least
   * one anchor must. Markers are the cheap reject; anchors are the identity.
   *
   * Matching is case-insensitive, unlike the flight workshop's
   * `bodyMarkers` — a hotel mail is prose written by a marketing team, and
   * the same sender ships "Reservation Confirmation" and "RESERVATION
   * CONFIRMATION" in the same year.
   */
  match: { markers: string[]; anchors: string[] };
  /**
   * Every label this sender puts on a line of its own, used ONLY as a stop
   * list: a `stacked` read never returns another label as a value. Without it
   * a field the mail left empty reports the next field's content — a
   * plausible wrong value, which is worse than the honest gap. The Booking.com
   * reader keeps the same list for the same reason.
   */
  labels?: string[];
  /** Judgement about the place itself, where the sender's identity settles it. */
  classify?: { type?: ParsedLodgingBooking["type"]; chainName?: string };
  /** How to read each field. A field with no rule is simply not read. */
  fields: LodgingFieldRules;
  /**
   * What the reader must find before it claims the document. A template that
   * matches and extracts nothing is worse than one that never ran, because
   * its result is a proposal a human accepts by habit (plan §7).
   */
  required: Array<keyof LodgingFieldRules>;
}

export type LodgingFieldRules = Partial<
  Record<
    | "hotelName"
    | "checkIn"
    | "checkOut"
    | "roomCategory"
    | "address"
    | "city"
    | "postcode"
    | "country"
    | "totalPrice"
    | "pricePerNight"
    | "currency"
    | "guests"
    | "confirmationNumber",
    FieldRule
  >
>;

/**
 * One field: where to look, and what the capture means.
 *
 * `patterns` are tried in order and the first that matches wins, which is how
 * a sender that changed its wording keeps one template instead of two.
 */
export interface FieldRule {
  patterns?: string[];
  /**
   * The label whose value sits on its own line, below it.
   *
   * A regex cannot do this safely. Written as `Anreise\s*\n\s*(…)` it reaches
   * across blank lines into the NEXT label's value, so a label with nothing
   * under it silently reports its neighbour's — measured, and exactly the bug
   * the Booking.com reader carries a stop-list against. Written tightly
   * (`[ \t]*\r?\n[ \t]*`) it cannot cross the blank line that CHECK24 really
   * puts between label and value, and reads nothing at all.
   *
   * So the engine walks: find the label on a line of its own, step over blank
   * lines, and take the first line with content — unless that line is another
   * of this template's `labels`, in which case the field is absent and says so.
   */
  stacked?: string;
  /**
   * Drop a leading word before transforming — "Di. 10. März 2026" → the date.
   * Only meaningful with `stacked`.
   */
  dropLeadingWord?: boolean;
  /** Regex flags. `i` is the default; `s` where a value spans lines. */
  flags?: string;
  transform?: TransformName;
  /**
   * For a date whose year the line does not carry (Hilton writes "Oct 01"):
   * take the year from this field's own match instead. Without it a stay in
   * October 2018 lands in whichever year the import happens to run.
   */
  yearFrom?: "subjectYear";
}

export type TransformName =
  /** "November 25, 2022" and "25 November 2022" and "Nov 01". */
  | "englishDate"
  /** "10. März 2026", with or without the ordinal dot — the Booking.com reader's own. */
  | "germanDate"
  /** "1.234,56" / "1,234.56" / "47.87" -> a number. */
  | "money"
  /** A three-letter ISO code or one of the symbols the tables know. */
  | "currency"
  /** Collapse inner whitespace, drop a trailing comma. */
  | "text"
  /** First integer in the capture, as a number. */
  | "integer"
  /**
   * The first run of digits, kept as TEXT — a booking reference is an
   * identifier, not a quantity. "260308233983 (gebucht am Mo. 9. Mrz 2026)"
   * yields "260308233983", and a leading zero would survive, which `integer`
   * would eat.
   */
  | "digits";
