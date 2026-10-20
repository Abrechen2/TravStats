import type { TemplateEnvelope } from "../templates/v2/envelope";
import type { FieldRule, InnerRepeatRule, ItemFieldRule } from "../templates/v2/extraction";
import { TRANSFORMS } from "../templates/v2/transforms";
import { labelOfDomain } from "../../../shared/annotationLabels";
import { applyV2RailTemplate } from "../../rail/parser/v2Rail";
import type { AnnotationSelection } from "./annotations";
import {
  buildRowRepeat,
  headingDayRule,
  lineStartOf,
  rowMarks,
  type RowMark,
  type RowValueShape,
} from "./rowDerivation";
import {
  anchorsFor,
  buildWorkshopEnvelope,
  deriveField,
  type WorkshopDerivationInput,
} from "./v2Derivation";

/**
 * Turn a user's annotated rail booking into a v2 `rail` template
 * (forgejo#309) — the same kind of file the repository's Deutsche Bahn
 * readers are, run by the same consumer (`rail/parser/v2Rail.ts`). No
 * operator-specific TypeScript: the layout lives in the template.
 *
 * What the user marks:
 *  - booking fields (reference, operator, class, fare, total, currency) → one
 *    bounded label pattern each, as the other v2 derivers write them;
 *  - ONE leg row — its stations, its departure time, and optionally its
 *    arrival time and train → the repeat that reads every leg like it
 *    (`rowDerivation.ts`);
 *  - the leg's DAY, either on the row itself or on a heading line above the
 *    legs ("Hinfahrt am 14.11.2027"). A heading day becomes a `lastBefore`
 *    field, so every leg takes the heading in force above it — a return
 *    section's heading dates the return legs, never the outbound day.
 *
 * Times stay what the document prints: `YYYY-MM-DDTHH:mm` on each station's
 * own clock. An arrival without its own day is the departure's day, or the
 * next one when its clock reads earlier (`laterClock`).
 *
 * It abstains rather than write a template that reads nothing: without a
 * complete leg row, without a day, or when the built template does not read
 * its OWN sample through the rail consumer.
 */

export type RailDerivationRefusal =
  | "railNeedsLegRow"
  | "railNeedsDate"
  | "railRowTooFarApart"
  | "railRowNotUnderstood"
  | "dateNotUnderstood"
  | "noDistinguishingMarker"
  | "templateReadsNothing";

export type RailDerivation =
  { ok: true; template: TemplateEnvelope } | { ok: false; refusal: RailDerivationRefusal };

/** Annotation label → the leg item's capture name, and how its value is read. */
const LEG_ROW: Readonly<Record<string, { field: string; shape: RowValueShape }>> = {
  depStation: { field: "depStationName", shape: "text" },
  arrStation: { field: "arrStationName", shape: "text" },
  departureTime: { field: "depTime", shape: "time" },
  arrivalTime: { field: "arrTime", shape: "time" },
  train: { field: "train", shape: "text" },
};

/** The two day labels: read from the row when marked on it, else from the heading above. */
const DAY_LABELS: Readonly<Record<string, { field: string; shape: RowValueShape }>> = {
  departureDate: { field: "day", shape: "date" },
  arrivalDate: { field: "arrDay", shape: "date" },
};

const LEG_LABELS = new Set([...Object.keys(LEG_ROW), ...Object.keys(DAY_LABELS)]);

/** Values that name the issuer, not the booking — read by their own line when unlabelled. */
const ISSUER_FIELDS = new Set(["operator"]);

/**
 * A train as printed ("RE 89", "ICE 1234", "S 1"): the letters are the
 * category, the digits the number. Generic on purpose — the category is
 * whatever the operator prints, never a list of one country's products.
 */
const TRAIN_CATEGORY = { pattern: "^\\s*([A-Za-zÄÖÜäöü]{1,6})", flags: "" };
const TRAIN_NUMBER = { pattern: "(\\d{1,6})", flags: "" };

function rowItemField(mark: RowMark): ItemFieldRule {
  switch (mark.field) {
    case "train":
      // Two fields from the one marked value; the find decides which part.
      return { group: "train", find: TRAIN_CATEGORY };
    case "day":
    case "arrDay":
      return { group: mark.field, transform: "date" };
    case "depTime":
    case "arrTime":
      return { group: mark.field, transform: "time" };
    default:
      return { group: mark.field, transform: "text" };
  }
}

type LegsBuild =
  { ok: true; repeat: InnerRepeatRule } | { ok: false; refusal: RailDerivationRefusal };

function buildLegs(input: WorkshopDerivationInput): LegsBuild {
  const { fullText, selections } = input;
  const row = rowMarks(selections, LEG_ROW);
  const fields = new Set(row.map((m) => m.field));
  if (!fields.has("depStationName") || !fields.has("arrStationName") || !fields.has("depTime")) {
    return { ok: false, refusal: "railNeedsLegRow" };
  }
  const days = rowMarks(selections, DAY_LABELS);
  const day = days.find((m) => m.field === "day");
  if (!day) return { ok: false, refusal: "railNeedsDate" };
  for (const mark of days) {
    if (TRANSFORMS.date(fullText.slice(mark.start, mark.end)) === null) {
      return { ok: false, refusal: "dateNotUnderstood" };
    }
  }

  // A day marked on one of the row's own lines is part of the row; anywhere
  // else it is a heading. An arrival day off the row says nothing per leg.
  const rowLines = new Set(row.map((m) => lineStartOf(fullText, m.start)));
  const onRow = days.filter((m) => rowLines.has(lineStartOf(fullText, m.start)));
  const marks = [...row, ...onRow].sort((a, b) => a.start - b.start);
  const itemFields: Record<string, ItemFieldRule> = Object.fromEntries(
    marks.map((m) => [m.field, rowItemField(m)])
  );
  if (fields.has("train")) itemFields.trainNumber = { group: "train", find: TRAIN_NUMBER };
  const dayOnRow = onRow.some((m) => m.field === "day");
  const hasArrDay = onRow.some((m) => m.field === "arrDay");

  const built = buildRowRepeat(fullText, marks, itemFields, { minimum: 1 });
  if (!built.ok) {
    return {
      ok: false,
      refusal: built.refusal === "rowTooFarApart" ? "railRowTooFarApart" : "railRowNotUnderstood",
    };
  }
  // The capture names that are not leg fields keep their value under their
  // own name; `trainCategory` is the train's letters.
  const { train: trainRule, ...rest } = itemFields;
  const repeatFields: Record<string, ItemFieldRule> = {
    ...rest,
    ...(trainRule ? { trainCategory: trainRule } : {}),
    ...(dayOnRow ? {} : { day: headingDayRule(fullText, day) }),
  };
  const arrivalLocal = !fields.has("arrTime")
    ? null
    : hasArrDay
      ? { format: "{arrDay}T{arrTime}" }
      : { format: "{day}T{depTime} {arrTime}", transform: "laterClock" as const };
  return {
    ok: true,
    repeat: {
      ...built.repeat,
      fields: repeatFields,
      compute: {
        departureLocal: { format: "{day}T{depTime}" },
        ...(arrivalLocal ? { arrivalLocal } : {}),
      },
      skipItemsWithout: ["departureLocal"],
    } as InnerRepeatRule,
  };
}

export function deriveRailTemplate(input: WorkshopDerivationInput): RailDerivation {
  const { fullText, selections } = input;
  const legs = buildLegs(input);
  if (!legs.ok) return legs;

  const fields: Record<string, FieldRule> = {
    documentKind: { value: "booking" },
    source: { value: "workshop" },
  };
  const labelLines: string[] = [];
  const stacked: string[] = [];
  for (const selection of selections) {
    if (LEG_LABELS.has(selection.label) || fields[selection.label]) continue;
    const label = labelOfDomain("rail", selection.label);
    if (!label) continue; // The route refuses a foreign label; this is the second lock.
    const derived = deriveField(
      selection,
      label.kind,
      fullText,
      selections as AnnotationSelection[],
      ISSUER_FIELDS.has(label.id)
    );
    if (!derived.ok) {
      if (derived.reason === "dateNotUnderstood") return { ok: false, refusal: derived.reason };
      continue;
    }
    // "2. Klasse" is stored as the class it names, never as the printed words.
    fields[label.id] =
      label.id === "travelClass"
        ? { ...derived.field.rule, transform: "travelClass" }
        : derived.field.rule;
    const line = derived.field.labelLine;
    if (line && !labelLines.includes(line)) labelLines.push(line);
    if (line && derived.field.rule.stacked !== undefined) stacked.push(line);
  }

  const issuerValues = selections.filter((s) => s.label === "operator").map((s) => s.text.trim());
  const anchors = anchorsFor({
    subject: input.subject,
    fullText,
    senderDomain: input.senderDomain,
    labelLines,
    issuerValues,
  });
  if (anchors.length === 0) return { ok: false, refusal: "noDistinguishingMarker" };

  const template = buildWorkshopEnvelope({
    domain: "rail",
    trainingDataId: input.trainingDataId,
    issuerName: issuerValues[0] || input.senderDomain || "Bahn",
    senderDomain: input.senderDomain,
    // The label lines are this operator's wording; two is enough.
    markers: labelLines.filter((line) => !/\d/.test(line)).slice(0, 2),
    anchors,
    extraction: {
      preprocess: ["stripCarriageReturns"],
      fields,
      ...(stacked.length > 0 ? { labels: stacked } : {}),
      repeats: { legs: legs.repeat },
      required: ["legs"],
    },
  });
  if (!template) return { ok: false, refusal: "templateReadsNothing" };
  // Read its OWN sample through the consumer the rail parser uses.
  if (applyV2RailTemplate(template, `${input.subject}\n${fullText}`) === null) {
    return { ok: false, refusal: "templateReadsNothing" };
  }
  return { ok: true, template };
}
