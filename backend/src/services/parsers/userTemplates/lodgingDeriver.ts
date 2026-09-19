import { parseEnglishDate } from "../../lodging/templates/engine";
import { parseGermanDate } from "../../lodging/bookingComTemplate";
import type {
  FieldRule,
  LodgingFieldRules,
  LodgingTemplate,
  TransformName,
} from "../../lodging/templates/types";
import type { AnnotationSelection } from "./annotations";
import { escapeRegex, labelContextOf } from "./annotations";
import { isLabelOfDomain } from "../../../shared/annotationLabels";

/**
 * Turn a user's annotated hotel confirmation into a declarative lodging
 * template — the SAME shape as the built-in KOA / Hilton / CHECK24 readers
 * (`services/lodging/templates/types.ts`), run by the same engine.
 *
 * forgejo#124 phase 6. The alternative would have been a second lodging
 * reader that only user templates use, which is the "two vocabularies" the
 * plan spends §3 and §5 arguing against: a user-derived template is not a
 * lesser kind of thing than a built-in one, it just has an author.
 *
 * The derivation is deliberately conservative. It abstains rather than
 * producing a template that matches a document and extracts nothing — the
 * plan's own trap ("a matching template is not an extracting template", §7),
 * and the reason the built-ins carry `required`.
 */

/** Why no template was written. Each maps to `parser:derivation.cannot.<id>`. */
export type LodgingDerivationRefusal =
  "lodgingNeedsNameAndDates" | "lodgingDateNotUnderstood" | "noDistinguishingMarker";

export type LodgingDerivation =
  { ok: true; template: LodgingTemplate } | { ok: false; refusal: LodgingDerivationRefusal };

/** Name + a date range. Anything less is not a stay, it is a guess. */
const REQUIRED: ReadonlyArray<keyof LodgingFieldRules> = ["hotelName", "checkIn", "checkOut"];

const TRANSFORMS: Partial<Record<string, TransformName>> = {
  totalPrice: "money",
  pricePerNight: "money",
  currency: "currency",
  guests: "integer",
};

/**
 * What the capture may contain, per field shape.
 *
 * Every class stops at the end of the line, because a line is what a
 * confirmation puts one value on. A greedy `[\s\S]` capture reaches into the
 * next field, which is the failure the phase 4 engine's `readStacked` exists
 * to avoid; there is no reason to reintroduce it here.
 */
const CAPTURE: Record<string, string> = {
  money: "([0-9][0-9.,\\s]{0,14})",
  currency: "([^\\r\\n]{1,20})",
  integer: "(\\d{1,3})",
  digits: "([0-9][0-9\\s-]{2,29})",
  date: "([^\\r\\n]{4,40})",
  text: "([^\\r\\n]{1,80})",
};

/**
 * German or English month names — which one this sender writes.
 *
 * Probed against the value the user actually annotated instead of guessed
 * from the locale, and a value NEITHER reader understands (a numeric
 * `12.03.2026`, which `parseGermanDate` does not accept) makes the derivation
 * refuse. Writing a template whose date transform returns null on the very
 * document it was derived from would produce a reader that matches every mail
 * from this sender and declines all of them.
 */
function dateTransform(sample: string): TransformName | null {
  if (parseGermanDate(sample) !== null) return "germanDate";
  if (parseEnglishDate(sample, 2000) !== null) return "englishDate";
  return null;
}

function transformFor(label: string, value: string): TransformName | null {
  if (label === "checkIn" || label === "checkOut") return dateTransform(value);
  if (label === "confirmationNumber") return /^[\s\d-]+$/.test(value) ? "digits" : "text";
  return TRANSFORMS[label] ?? "text";
}

function captureFor(transform: TransformName): string {
  if (transform === "germanDate" || transform === "englishDate") return CAPTURE.date;
  return CAPTURE[transform] ?? CAPTURE.text;
}

/**
 * Words a confirmation subject shares with every other confirmation subject.
 *
 * Not a stop-list for tidiness: an anchor built out of these is an anchor that
 * matches the competition. "Ihre Buchungsbestätigung" is the subject Booking.com,
 * a Pension and a chain hotel all send, so a personal template anchored on it
 * claims the next hotel mail that arrives and proposes THIS sender's fields
 * for it — plan §7 verbatim ("'Your reservation' is a subject a dozen chains
 * share"), and a plausible wrong value is the failure that costs most.
 */
const GENERIC_SUBJECT_WORDS = new Set([
  "ihre",
  "deine",
  "your",
  "die",
  "der",
  "das",
  "the",
  "for",
  "fuer",
  "für",
  "und",
  "and",
  "von",
  "from",
  "bei",
  "at",
  "in",
  "buchung",
  "buchungen",
  "buchungsbestaetigung",
  "buchungsbestätigung",
  "bestaetigung",
  "bestätigung",
  "reservierung",
  "reservierungsbestaetigung",
  "reservierungsbestätigung",
  "booking",
  "bookings",
  "confirmation",
  "confirmed",
  "reservation",
  "receipt",
  "voucher",
  "hotel",
  "unterkunft",
  "aufenthalt",
  "stay",
  "nacht",
  "naechte",
  "nächte",
  "night",
  "nights",
  "details",
  "info",
  "information",
  "no",
  "nr",
  "number",
  "nummer",
]);

const normaliseToken = (token: string): string =>
  token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * A brand token from the subject — or nothing.
 *
 * The subject is first stripped of what belongs to ONE booking (dates and
 * references identify the stay, not the sender, so a template anchored on
 * them matches exactly one mail). What is left is then required to contain a
 * word that is NOT in the generic list above: a name, in other words. Without
 * one this returns null and the caller abstains with `noDistinguishingMarker`
 * rather than shipping a template that claims other senders' mail.
 */
export function senderAnchorFromSubject(subject: string): string | null {
  const cleaned = subject
    .replace(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/g, " ")
    .replace(/\b\d{1,2}\s+\p{L}+\s+\d{4}\b/gu, " ")
    .replace(/\b[A-Z0-9]{6,}\b/g, " ")
    .replace(/[#|:_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 5) return null;

  const distinctive = cleaned
    .split(" ")
    .map(normaliseToken)
    .some((token) => token.length >= 3 && !GENERIC_SUBJECT_WORDS.has(token));
  return distinctive ? cleaned : null;
}

/**
 * Fields whose value belongs to the PLACE and not to the booking.
 *
 * Only these may be read by their own line. The distinction is the whole of
 * the rule's safety: a hotel writes its own name the same way in every
 * confirmation it sends, so a line carrying that name reads the next mail
 * correctly; a check-in date is different in every mail, and a rule built out
 * of one booking's date would read nothing from the next — a template that
 * matches and extracts nothing, which is the failure `required` exists
 * against (plan §7).
 */
const LINE_ANCHORABLE: ReadonlySet<keyof LodgingFieldRules> = new Set([
  "hotelName",
  "address",
  "city",
  "postcode",
  "country",
]);

/**
 * A rule for a value with NO label in front of it: the line is the marker.
 *
 * `labelContextOf` answers null when nothing precedes the value — the hotel's
 * own name on a letterhead line, which is exactly what a user marks first.
 * The field was simply skipped, and the derivation then refused with
 * "nothing marked but a name is not a stay" for an annotation whose name WAS
 * marked. The reason was wrong, which is worse than the refusal (beta audit
 * 2026-09-19, NOT FIXED 5a).
 *
 * The value stays LITERAL, and only its whitespace is generalised. A
 * shape-generalised line (`^Hotel[^\r\n]{0,60}$`) would also claim "Hotel
 * bewerten" two lines further down and report it as the hotel's name — a
 * plausible wrong value, which costs more here than no value at all. Literal
 * is narrow on purpose: it reads the next mail from THIS property, and
 * nothing else.
 *
 * Returns null when the pattern cannot find its own value back — a mark that
 * covers only part of the line, say. Better an honest refusal now than a
 * template the preview has to catch.
 */
function lineAnchoredRule(
  label: keyof LodgingFieldRules,
  value: string,
  transform: TransformName,
  fullText: string
): FieldRule | null {
  if (!LINE_ANCHORABLE.has(label)) return null;
  const pattern = `^[ \\t]*(${escapeRegex(value).replace(/\s+/g, "\\s+")})[ \\t]*$`;
  if (!new RegExp(pattern, "im").test(fullText)) return null;
  return { patterns: [pattern], flags: "im", transform };
}

export interface LodgingDerivationInput {
  /** `lodging:user:<trainingDataId>` — the registry key this template gets. */
  id: string;
  name: string;
  subject: string;
  fullText: string;
  selections: readonly AnnotationSelection[];
  senderDomain?: string;
}

export function deriveLodgingTemplate(input: LodgingDerivationInput): LodgingDerivation {
  const { fullText, selections } = input;
  const fields: LodgingFieldRules = {};
  const labelLines: string[] = [];
  let dateRefused = false;

  for (const selection of selections) {
    // The route refuses a foreign label at the boundary
    // (`routes/training.ts`); this is the second lock, because a cast alone
    // would make `fields["gate"]` a lodging rule the engine then ignores in
    // silence.
    if (!isLabelOfDomain("lodging", selection.label)) continue;
    const label = selection.label as keyof LodgingFieldRules;
    if (fields[label]) continue; // First annotation of a field wins.
    const value = selection.text.trim();
    if (value.length === 0) continue;

    const transform = transformFor(selection.label, value);
    if (transform === null) {
      if (selection.label === "checkIn" || selection.label === "checkOut") dateRefused = true;
      continue;
    }

    const context = labelContextOf(fullText, selection.start);
    if (context === null) {
      const lineRule = lineAnchoredRule(label, value, transform, fullText);
      if (lineRule) fields[label] = lineRule;
      continue;
    }
    if (!labelLines.includes(context.label)) labelLines.push(context.label);

    // A value that starts its own line is read by walking down from the label
    // (the engine's `readStacked`), never by a regex: the phase 4 header
    // explains both regex shapes that fail here, and the walk is what copes
    // with the blank line CHECK24 puts between label and value.
    const rule: FieldRule = context.stacked
      ? { stacked: context.label, transform }
      : { patterns: [`${escapeRegex(context.label)}\\s*${captureFor(transform)}`], transform };
    fields[label] = rule;
  }

  const missing = REQUIRED.filter((field) => fields[field] === undefined);
  if (missing.length > 0) {
    return {
      ok: false,
      refusal: dateRefused ? "lodgingDateNotUnderstood" : "lodgingNeedsNameAndDates",
    };
  }

  const anchors: string[] = [];
  const subjectAnchor = senderAnchorFromSubject(input.subject);
  if (subjectAnchor) anchors.push(subjectAnchor);
  // An anchor is only an anchor where the reader will look for it, and
  // `applyLodgingTemplate` searches the subject and the body joined by a
  // newline. Checking the body alone dropped a domain that only the subject
  // names, and — worse — would have let a domain through that the engine
  // could never find, now that the subject is read from a column rather than
  // out of the text.
  const haystack = [input.subject, fullText].join("\n").toLowerCase();
  if (input.senderDomain && haystack.includes(input.senderDomain.toLowerCase())) {
    anchors.push(input.senderDomain);
  }
  if (anchors.length === 0) {
    // Nothing identifies the SENDER, only this booking. A template with no
    // anchor matches every lodging document the user ever parses.
    return { ok: false, refusal: "noDistinguishingMarker" };
  }

  return {
    ok: true,
    template: {
      id: input.id,
      name: input.name,
      // The annotated fields' own label lines are the cheap reject: they are
      // this sender's wording, present in every mail it sends, and absent
      // from everyone else's. Two is enough — more makes a reader that stops
      // working the day the sender reflows one line.
      match: { markers: labelLines.slice(0, 2), anchors },
      // The full label list is the stop-list a stacked read needs, so a field
      // the mail left empty reports nothing instead of its neighbour's value.
      labels: labelLines,
      fields,
      required: [...REQUIRED],
    },
  };
}
