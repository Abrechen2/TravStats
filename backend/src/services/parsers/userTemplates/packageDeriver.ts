import type { TemplateEnvelope } from "../templates/v2/envelope";
import type { FieldRule, InnerRepeatRule, ItemFieldRule } from "../templates/v2/extraction";
import type { TransformName } from "../templates/v2/transforms";
import { labelOfDomain } from "../../../shared/annotationLabels";
import { parsePackageText } from "../../trip/package/parsePackage";
import { buildRowRepeat, rowMarks, type RowValueShape } from "./rowDerivation";
import {
  anchorsFor,
  buildWorkshopEnvelope,
  deriveField,
  type WorkshopDerivationInput,
} from "./v2Derivation";

/**
 * Turn a user's annotated tour-operator document into a v2 `package`
 * template (forgejo#124) — the same kind of file the repository's package
 * templates are, run by the same reader (`trip/package/parsePackage.ts`) and
 * checked by the same contract (`trip/package/contract.ts`).
 *
 * What the user marks:
 *  - the booking fields (booking reference and issue date are what the
 *    contract requires; trip name, dates, travellers, total and currency
 *    when present) → one bounded label pattern each;
 *  - ONE flight row and/or ONE hotel row → each becomes the repeat that reads
 *    every row like it (`rowDerivation.ts`): on one line a `matchAll`, over
 *    two consecutive lines a `lines` repeat.
 *
 * It abstains rather than writing a template that reads nothing: without
 * the required booking fields, without a complete row, or when the built
 * template does not read its OWN sample through the package reader.
 */

export type PackageDerivationRefusal =
  | "packageNeedsBookingFields"
  | "packageNeedsRow"
  | "packageFlightRowIncomplete"
  | "packageStayRowIncomplete"
  | "packageRowTooFarApart"
  | "packageRowNotUnderstood"
  | "dateNotUnderstood"
  | "noDistinguishingMarker"
  | "templateReadsNothing";

export type PackageDerivation =
  { ok: true; template: TemplateEnvelope } | { ok: false; refusal: PackageDerivationRefusal };

/** Annotation label → the contract's flight field, and how its value is read. */
const FLIGHT_ROW: Readonly<Record<string, { field: string; shape: RowValueShape }>> = {
  flightNumber: { field: "flightNumber", shape: "flightNumber" },
  flightDate: { field: "date", shape: "date" },
  flightDepIata: { field: "depIata", shape: "iata" },
  flightArrIata: { field: "arrIata", shape: "iata" },
  flightDepCity: { field: "depCity", shape: "text" },
  flightArrCity: { field: "arrCity", shape: "text" },
  flightDepTime: { field: "depTime", shape: "time" },
  flightArrTime: { field: "arrTime", shape: "time" },
};

const STAY_ROW: Readonly<Record<string, { field: string; shape: RowValueShape }>> = {
  stayName: { field: "name", shape: "text" },
  stayCheckIn: { field: "checkIn", shape: "date" },
  stayCheckOut: { field: "checkOut", shape: "date" },
  stayCity: { field: "city", shape: "text" },
};

const ROW_LABELS = new Set([...Object.keys(FLIGHT_ROW), ...Object.keys(STAY_ROW)]);

const TRANSFORM_FOR_SHAPE: Record<RowValueShape, TransformName> = {
  date: "date",
  time: "time",
  iata: "iata",
  flightNumber: "flightNumber",
  amount: "amount",
  count: "integer",
  text: "text",
};

function itemFields(marks: ReturnType<typeof rowMarks>): Record<string, ItemFieldRule> {
  return Object.fromEntries(
    marks.map((m) => [m.field, { group: m.field, transform: TRANSFORM_FOR_SHAPE[m.shape] }])
  );
}

type RowOutcome =
  { ok: true; repeat: InnerRepeatRule | null } | { ok: false; refusal: PackageDerivationRefusal };

/** One row repeat, or null when nothing of that row was marked. */
function row(
  input: WorkshopDerivationInput,
  labels: Readonly<Record<string, { field: string; shape: RowValueShape }>>,
  complete: (fields: Set<string>) => boolean,
  incomplete: PackageDerivationRefusal
): RowOutcome {
  const marks = rowMarks(input.selections, labels);
  if (marks.length === 0) return { ok: true, repeat: null };
  if (!complete(new Set(marks.map((m) => m.field)))) return { ok: false, refusal: incomplete };
  const built = buildRowRepeat(input.fullText, marks, itemFields(marks));
  if (!built.ok) {
    return {
      ok: false,
      refusal:
        built.refusal === "rowTooFarApart" ? "packageRowTooFarApart" : "packageRowNotUnderstood",
    };
  }
  return { ok: true, repeat: built.repeat };
}

const flightComplete = (f: Set<string>): boolean =>
  f.has("flightNumber") &&
  f.has("date") &&
  (f.has("depIata") || f.has("depCity")) &&
  (f.has("arrIata") || f.has("arrCity"));

const stayComplete = (f: Set<string>): boolean =>
  f.has("name") && f.has("checkIn") && f.has("checkOut");

export function derivePackageTemplate(input: WorkshopDerivationInput): PackageDerivation {
  const { fullText, selections } = input;
  const fields: Record<string, FieldRule> = {};
  const labelLines: string[] = [];
  const stacked: string[] = [];
  for (const selection of selections) {
    if (ROW_LABELS.has(selection.label) || fields[selection.label]) continue;
    const label = labelOfDomain("package", selection.label);
    if (!label) continue;
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
  if (!fields.bookingReference || !fields.issuedOn) {
    return { ok: false, refusal: "packageNeedsBookingFields" };
  }

  const flights = row(input, FLIGHT_ROW, flightComplete, "packageFlightRowIncomplete");
  if (!flights.ok) return flights;
  const stays = row(input, STAY_ROW, stayComplete, "packageStayRowIncomplete");
  if (!stays.ok) return stays;
  if (!flights.repeat && !stays.repeat) return { ok: false, refusal: "packageNeedsRow" };

  const anchors = anchorsFor({
    subject: input.subject,
    fullText,
    senderDomain: input.senderDomain,
    labelLines,
    issuerValues: [],
  });
  if (anchors.length === 0) return { ok: false, refusal: "noDistinguishingMarker" };

  const template = buildWorkshopEnvelope({
    domain: "package",
    trainingDataId: input.trainingDataId,
    issuerName: input.senderDomain || "Reiseveranstalter",
    senderDomain: input.senderDomain,
    // The label lines are this operator's wording; two is enough.
    markers: labelLines.filter((line) => !/\d/.test(line)).slice(0, 2),
    anchors,
    extraction: {
      preprocess: ["stripCarriageReturns"],
      fields,
      ...(stacked.length > 0 ? { labels: stacked } : {}),
      repeats: {
        ...(flights.repeat ? { flights: flights.repeat } : {}),
        ...(stays.repeat ? { stays: stays.repeat } : {}),
      },
      required: ["bookingReference", "issuedOn"],
    },
  });
  if (!template) return { ok: false, refusal: "templateReadsNothing" };
  // Read its OWN sample through the reader and contract the parser uses.
  const own = parsePackageText(`${input.subject}\n${fullText}`, [template]);
  const reading = own.reading;
  if (
    !reading ||
    (flights.repeat && reading.flights.length === 0) ||
    (stays.repeat && reading.stays.length === 0)
  ) {
    return { ok: false, refusal: "templateReadsNothing" };
  }
  return { ok: true, template };
}
