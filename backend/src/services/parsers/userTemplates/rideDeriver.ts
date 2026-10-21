import type { TemplateEnvelope } from "../templates/v2/envelope";
import type { FieldRule, InnerRepeatRule, ItemFieldRule } from "../templates/v2/extraction";
import { TRANSFORMS } from "../templates/v2/transforms";
import { labelOfDomain } from "../../../shared/annotationLabels";
import { applyV2RideTicketTemplate, CARRIER_FIELD } from "../../rides/v2RideTicket";
import type { AnnotationSelection } from "./annotations";
import {
  buildRowRepeat,
  headingDayRule,
  lineStartOf,
  rowMarks,
  type RowValueShape,
} from "./rowDerivation";
import {
  anchorsFor,
  buildWorkshopEnvelope,
  deriveField,
  type WorkshopDerivationInput,
} from "./v2Derivation";

/**
 * Turn a user's annotated coach or ferry ticket into a v2 `bus` / `ferry`
 * template (forgejo#309), run by the generic consumer
 * `rides/v2RideTicket.ts`. The rail reading with terminals for stations: no
 * operator-specific TypeScript, the layout lives in the template.
 *
 * What the user marks:
 *  - booking fields (reference, operator, total, currency) → one bounded
 *    label pattern each, as the other v2 derivers write them;
 *  - ONE ride row — its two terminals and its departure time, optionally its
 *    arrival time → the repeat that reads every ride like it;
 *  - the day, on the row itself or on a heading above the rides (a heading
 *    day becomes a `lastBefore` field, so a return heading dates its rides);
 *  - the carrier (a coach line, a vessel): on the row it is read per ride,
 *    anywhere else once for the ticket.
 *
 * Times stay what the ticket prints, on each terminal's own clock; an arrival
 * without its own day is the departure's day, or the next one when its clock
 * reads earlier by more than a zone step; one just earlier is left unread
 * (`laterClock`). It abstains rather than write a template that
 * reads nothing: without a complete row, without a day, without a sender
 * anchor, or when the built template does not read its OWN sample.
 */

export type RideDomain = "bus" | "ferry";

export type RideDerivationRefusal =
  | "rideNeedsRow"
  | "rideNeedsDate"
  | "rideRowTooFarApart"
  | "rideRowNotUnderstood"
  | "dateNotUnderstood"
  | "noDistinguishingMarker"
  | "templateReadsNothing";

export type RideDerivation =
  { ok: true; template: TemplateEnvelope } | { ok: false; refusal: RideDerivationRefusal };

/** Per domain: which labels name the two terminals, and which the carrier. */
const ROW_LABELS: Readonly<Record<RideDomain, { dep: string; arr: string; carrier: string }>> = {
  bus: { dep: "depStop", arr: "arrStop", carrier: "line" },
  ferry: { dep: "depPort", arr: "arrPort", carrier: "vessel" },
};

const ISSUER_NAME: Readonly<Record<RideDomain, string>> = { bus: "Bus", ferry: "Fähre" };

type RowSpec = Readonly<Record<string, { field: string; shape: RowValueShape }>>;

function rowSpec(domain: RideDomain): RowSpec {
  const labels = ROW_LABELS[domain];
  return {
    [labels.dep]: { field: "depName", shape: "text" },
    [labels.arr]: { field: "arrName", shape: "text" },
    departureTime: { field: "depTime", shape: "time" },
    arrivalTime: { field: "arrTime", shape: "time" },
  };
}

const DAY_LABELS: RowSpec = {
  departureDate: { field: "day", shape: "date" },
  arrivalDate: { field: "arrDay", shape: "date" },
};

function itemField(field: string): ItemFieldRule {
  if (field === "day" || field === "arrDay") return { group: field, transform: "date" };
  if (field === "depTime" || field === "arrTime") return { group: field, transform: "time" };
  return { group: field, transform: "text" };
}

type RowBuild =
  | { ok: true; repeat: InnerRepeatRule; carrierOnRow: boolean }
  | { ok: false; refusal: RideDerivationRefusal };

function buildRides(domain: RideDomain, input: WorkshopDerivationInput): RowBuild {
  const { fullText, selections } = input;
  const carrierField = CARRIER_FIELD[domain];
  const row = rowMarks(selections, rowSpec(domain));
  const fields = new Set(row.map((m) => m.field));
  if (!fields.has("depName") || !fields.has("arrName") || !fields.has("depTime")) {
    return { ok: false, refusal: "rideNeedsRow" };
  }
  const days = rowMarks(selections, DAY_LABELS);
  const day = days.find((m) => m.field === "day");
  if (!day) return { ok: false, refusal: "rideNeedsDate" };
  for (const mark of days) {
    if (TRANSFORMS.date(fullText.slice(mark.start, mark.end)) === null) {
      return { ok: false, refusal: "dateNotUnderstood" };
    }
  }

  // A day or a carrier marked on one of the row's own lines is part of the
  // row; anywhere else it is a heading (a day) or a ticket field (a carrier).
  const rowLines = new Set(row.map((m) => lineStartOf(fullText, m.start)));
  const onRow = (start: number) => rowLines.has(lineStartOf(fullText, start));
  const daysOnRow = days.filter((m) => onRow(m.start));
  const carrier = rowMarks(selections, {
    [ROW_LABELS[domain].carrier]: { field: carrierField, shape: "text" },
  }).filter((m) => onRow(m.start));
  const marks = [...row, ...daysOnRow, ...carrier].sort((a, b) => a.start - b.start);
  const itemFields: Record<string, ItemFieldRule> = Object.fromEntries(
    marks.map((m) => [m.field, itemField(m.field)])
  );
  const built = buildRowRepeat(fullText, marks, itemFields, { minimum: 1 });
  if (!built.ok) {
    return {
      ok: false,
      refusal: built.refusal === "rowTooFarApart" ? "rideRowTooFarApart" : "rideRowNotUnderstood",
    };
  }
  const dayOnRow = daysOnRow.some((m) => m.field === "day");
  const hasArrDay = daysOnRow.some((m) => m.field === "arrDay");
  const arrivalLocal = !fields.has("arrTime")
    ? null
    : hasArrDay
      ? { format: "{arrDay}T{arrTime}" }
      : { format: "{day}T{depTime} {arrTime}", transform: "laterClock" as const };
  return {
    ok: true,
    carrierOnRow: carrier.length > 0,
    repeat: {
      ...built.repeat,
      fields: { ...itemFields, ...(dayOnRow ? {} : { day: headingDayRule(fullText, day) }) },
      compute: {
        departureLocal: { format: "{day}T{depTime}" },
        ...(arrivalLocal ? { arrivalLocal } : {}),
      },
      skipItemsWithout: ["departureLocal"],
    } as InnerRepeatRule,
  };
}

/** The labels read by the row; everything else is a ticket field. */
function rowLabelSet(domain: RideDomain): Set<string> {
  return new Set([...Object.keys(rowSpec(domain)), ...Object.keys(DAY_LABELS)]);
}

export function deriveRideTemplate(
  domain: RideDomain,
  input: WorkshopDerivationInput
): RideDerivation {
  const { fullText, selections } = input;
  const rides = buildRides(domain, input);
  if (!rides.ok) return rides;

  const carrierLabel = ROW_LABELS[domain].carrier;
  const skip = rowLabelSet(domain);
  if (rides.carrierOnRow) skip.add(carrierLabel);
  const fields: Record<string, FieldRule> = { source: { value: "workshop" } };
  const labelLines: string[] = [];
  const stacked: string[] = [];
  for (const selection of selections) {
    if (skip.has(selection.label)) continue;
    const label = labelOfDomain(domain, selection.label);
    if (!label) continue; // The route refuses a foreign label; this is the second lock.
    const name = label.id === carrierLabel ? CARRIER_FIELD[domain] : label.id;
    if (fields[name]) continue;
    const derived = deriveField(
      selection,
      label.kind,
      fullText,
      selections as AnnotationSelection[],
      label.id === "operator"
    );
    if (!derived.ok) {
      if (derived.reason === "dateNotUnderstood") return { ok: false, refusal: derived.reason };
      continue;
    }
    fields[name] = derived.field.rule;
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
    domain,
    trainingDataId: input.trainingDataId,
    issuerName: issuerValues[0] || input.senderDomain || ISSUER_NAME[domain],
    senderDomain: input.senderDomain,
    // The label lines are this operator's wording; two is enough.
    markers: labelLines.filter((line) => !/\d/.test(line)).slice(0, 2),
    anchors,
    extraction: {
      preprocess: ["stripCarriageReturns"],
      fields,
      ...(stacked.length > 0 ? { labels: stacked } : {}),
      repeats: { rides: rides.repeat },
      required: ["rides"],
    },
  });
  if (!template) return { ok: false, refusal: "templateReadsNothing" };
  // Read its OWN sample through the consumer the parse uses.
  if (applyV2RideTicketTemplate(template, `${input.subject}\n${fullText}`) === null) {
    return { ok: false, refusal: "templateReadsNothing" };
  }
  return { ok: true, template };
}

export const deriveBusTemplate = (input: WorkshopDerivationInput): RideDerivation =>
  deriveRideTemplate("bus", input);

export const deriveFerryTemplate = (input: WorkshopDerivationInput): RideDerivation =>
  deriveRideTemplate("ferry", input);
