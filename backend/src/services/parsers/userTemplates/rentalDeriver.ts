import type { TemplateEnvelope } from "../templates/v2/envelope";
import type { FieldRule } from "../templates/v2/extraction";
import { TRANSFORMS } from "../templates/v2/transforms";
import { labelOfDomain } from "../../../shared/annotationLabels";
import { applyV2RentalTemplate } from "../../rental/parser/v2Rental";
import {
  anchorsFor,
  buildWorkshopEnvelope,
  deriveField,
  type WorkshopDerivationInput,
} from "./v2Derivation";

/**
 * Turn a user's annotated rental confirmation into a v2 `rental` template
 * (forgejo#309) — the same kind of file the repository's provider readers
 * are, run by the same consumer (`rental/parser/v2Rental.ts`). No
 * provider-specific TypeScript: the layout lives in the template.
 *
 * A rental is one record, not a list, so every mark becomes one bounded label
 * pattern. Each end is a station, a day and — when printed — a clock; the
 * consumer joins day and clock into the end's wall clock, and keeps a bare
 * day when no clock is printed. The provider is the issuer: the marked name
 * is written as a constant, never read back per document.
 *
 * It abstains rather than write a template that reads nothing or the wrong
 * thing: without the provider or the fields a confirmation needs, when the
 * built template does not read its own sample, and when it reads its own
 * sample WRONG — pickup and return labelled alike, so one rule reads the
 * other end's value.
 */

export type RentalDerivationRefusal =
  | "rentalNeedsProvider"
  | "rentalNeedsBookingFields"
  | "rentalEndsAmbiguous"
  | "dateNotUnderstood"
  | "noDistinguishingMarker"
  | "templateReadsNothing";

export type RentalDerivation =
  { ok: true; template: TemplateEnvelope } | { ok: false; refusal: RentalDerivationRefusal };

/** What a confirmation is not without (`v2Rental.ts` declines it otherwise). */
const REQUIRED = [
  "confirmationNumber",
  "pickupStation",
  "pickupDate",
  "returnStation",
  "returnDate",
] as const;

/**
 * The marked values the template must read back from its own sample. The
 * clocks are checked when marked: two "Zeit:" lines would give both ends the
 * same rule, and the return would read the pickup's clock.
 */
const READ_BACK = [
  "pickupStation",
  "pickupDate",
  "pickupTime",
  "returnStation",
  "returnDate",
  "returnTime",
] as const;

/** A marked value as the consumer writes it: a date or a clock normalised, the rest trimmed. */
function expectedReading(name: (typeof READ_BACK)[number], marked: string | null): string | null {
  if (!marked) return marked;
  if (name.endsWith("Date")) return TRANSFORMS.date(marked);
  if (name.endsWith("Time")) return TRANSFORMS.time(marked);
  return marked;
}

function markedValue(input: WorkshopDerivationInput, label: string): string | null {
  return input.selections.find((s) => s.label === label)?.text.trim() || null;
}

export function deriveRentalTemplate(input: WorkshopDerivationInput): RentalDerivation {
  const { fullText, selections } = input;
  const provider = markedValue(input, "provider");
  if (!provider) return { ok: false, refusal: "rentalNeedsProvider" };

  const fields: Record<string, FieldRule> = {
    kind: { value: "confirmation" },
    provider: { value: provider },
  };
  const labelLines: string[] = [];
  const stacked: string[] = [];
  for (const selection of selections) {
    if (selection.label === "provider" || fields[selection.label]) continue;
    const label = labelOfDomain("rental", selection.label);
    if (!label) continue; // The route refuses a foreign label; this is the second lock.
    const derived = deriveField(selection, label.kind, fullText, selections, false);
    if (!derived.ok) {
      if (derived.reason === "dateNotUnderstood") return { ok: false, refusal: derived.reason };
      continue;
    }
    fields[label.id] = derived.field.rule;
    const line = derived.field.labelLine;
    if (line && !labelLines.includes(line)) labelLines.push(line);
    if (line && derived.field.rule.stacked !== undefined) stacked.push(line);
  }
  if (REQUIRED.some((name) => !fields[name])) {
    return { ok: false, refusal: "rentalNeedsBookingFields" };
  }

  const anchors = anchorsFor({
    subject: input.subject,
    fullText,
    senderDomain: input.senderDomain,
    labelLines,
    issuerValues: [provider],
  });
  if (anchors.length === 0) return { ok: false, refusal: "noDistinguishingMarker" };

  const template = buildWorkshopEnvelope({
    domain: "rental",
    trainingDataId: input.trainingDataId,
    issuerName: provider,
    senderDomain: input.senderDomain,
    // The label lines are this provider's wording; two is enough.
    markers: labelLines.filter((line) => !/\d/.test(line)).slice(0, 2),
    anchors,
    extraction: {
      preprocess: ["stripCarriageReturns"],
      fields,
      ...(stacked.length > 0 ? { labels: stacked } : {}),
      required: [...REQUIRED],
    },
  });
  if (!template) return { ok: false, refusal: "templateReadsNothing" };

  // Read its OWN sample through the consumer the rental parser uses …
  const own = applyV2RentalTemplate(template, { subject: input.subject, text: fullText });
  if (!own || own.kind !== "confirmation") return { ok: false, refusal: "templateReadsNothing" };
  // … and read it RIGHT: each end's station, day and clock are the ones marked.
  const read: Record<(typeof READ_BACK)[number], string | null> = {
    pickupStation: own.pickup.stationName,
    pickupDate: own.pickup.local.slice(0, 10),
    pickupTime: own.pickup.local.slice(11, 16) || null,
    returnStation: own.return.stationName,
    returnDate: own.return.local.slice(0, 10),
    returnTime: own.return.local.slice(11, 16) || null,
  };
  for (const name of READ_BACK) {
    const marked = markedValue(input, name);
    // An unmarked clock is not checked: the consumer may still read one.
    if (!marked && name.endsWith("Time")) continue;
    if (read[name] !== expectedReading(name, marked)) {
      return { ok: false, refusal: "rentalEndsAmbiguous" };
    }
  }
  return { ok: true, template };
}
