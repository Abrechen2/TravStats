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
 * The subject, stripped of what belongs to ONE booking.
 *
 * Same idea as `extractFingerprint`'s subject cleaning on the flight side, and
 * for the same reason: a subject carrying this stay's dates and reference
 * identifies the booking, not the sender, so a template anchored on it would
 * match exactly one mail — the one it was derived from.
 */
export function senderAnchorFromSubject(subject: string): string | null {
  const cleaned = subject
    .replace(/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/g, " ")
    .replace(/\b\d{1,2}\s+\p{L}+\s+\d{4}\b/gu, " ")
    .replace(/\b[A-Z0-9]{6,}\b/g, " ")
    .replace(/[#|:_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 5 ? cleaned : null;
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
    if (context === null) continue;
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
  if (input.senderDomain && fullText.toLowerCase().includes(input.senderDomain.toLowerCase())) {
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
