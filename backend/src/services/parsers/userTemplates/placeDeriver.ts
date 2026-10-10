import type { TemplateEnvelope } from "../templates/v2/envelope";
import type { FieldRule } from "../templates/v2/extraction";
import { labelOfDomain } from "../../../shared/annotationLabels";
import { applyV2PlaceTemplate } from "../../places/v2Place";
import {
  anchorsFor,
  buildWorkshopEnvelope,
  deriveField,
  type WorkshopDerivationInput,
} from "./v2Derivation";

/**
 * Turn a user's annotated place document — a museum ticket, a tour booking —
 * into a v2 place template (forgejo#124). Its reader is the generic place
 * consumer (`services/places/v2Place.ts`); its result lands in the place
 * import preview, never straight in the database.
 *
 * The name is required: a place without one is not a row the import can
 * offer. Everything else is optional and read when marked.
 */

export type PlaceDerivationRefusal =
  "placeNeedsName" | "dateNotUnderstood" | "noDistinguishingMarker" | "templateReadsNothing";

export type PlaceDerivation =
  { ok: true; template: TemplateEnvelope } | { ok: false; refusal: PlaceDerivationRefusal };

/**
 * Values that belong to the PLACE and may therefore be read by their own line:
 * a museum prints its name and address the same way on every ticket. A visit
 * date differs on every ticket and would read nothing written literally.
 */
const PLACE_FIELDS = new Set(["name", "category", "address", "city", "country"]);

export function derivePlaceTemplate(input: WorkshopDerivationInput): PlaceDerivation {
  const { fullText, selections } = input;
  const fields: Record<string, FieldRule> = {};
  const labelLines: string[] = [];
  const stacked: string[] = [];

  for (const selection of selections) {
    if (fields[selection.label]) continue; // The first mark of a field wins.
    const label = labelOfDomain("place", selection.label);
    if (!label) continue;
    const derived = deriveField(
      selection,
      label.kind,
      fullText,
      selections,
      PLACE_FIELDS.has(label.id)
    );
    if (!derived.ok) {
      if (derived.reason === "dateNotUnderstood") return { ok: false, refusal: derived.reason };
      continue;
    }
    fields[label.id] = derived.field.rule;
    const line = derived.field.labelLine;
    if (line && !labelLines.includes(line)) labelLines.push(line);
    if (line && derived.field.rule.stacked !== undefined) stacked.push(line);
  }
  if (!fields.name) return { ok: false, refusal: "placeNeedsName" };

  const name = selections.find((s) => s.label === "name")?.text.trim() ?? "";
  const anchors = anchorsFor({
    subject: input.subject,
    fullText,
    senderDomain: input.senderDomain,
    labelLines,
    // The place's own name identifies the issuer of its tickets.
    issuerValues: [name],
  });
  if (anchors.length === 0) return { ok: false, refusal: "noDistinguishingMarker" };

  const template = buildWorkshopEnvelope({
    domain: "place",
    trainingDataId: input.trainingDataId,
    issuerName: name || input.senderDomain || "Ort",
    senderDomain: input.senderDomain,
    // Label lines are this issuer's wording; two is enough (see the lodging deriver).
    markers: labelLines.filter((line) => !/\d/.test(line)).slice(0, 2),
    anchors,
    extraction: {
      preprocess: ["stripCarriageReturns"],
      fields,
      ...(stacked.length > 0 ? { labels: stacked } : {}),
      required: ["name"],
    },
  });
  if (!template) return { ok: false, refusal: "templateReadsNothing" };
  if (!applyV2PlaceTemplate(template, `${input.subject}\n${fullText}`)) {
    return { ok: false, refusal: "templateReadsNothing" };
  }
  return { ok: true, template };
}
