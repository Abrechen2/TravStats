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
  patterns: string[];
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
  /** "1.234,56" / "1,234.56" / "47.87" -> a number. */
  | "money"
  /** A three-letter ISO code or one of the symbols the tables know. */
  | "currency"
  /** Collapse inner whitespace, drop a trailing comma. */
  | "text"
  /** First integer in the capture. */
  | "integer";
