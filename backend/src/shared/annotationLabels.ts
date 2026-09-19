/**
 * What the template workshop may be told about a document, per domain.
 *
 * MIRRORED at `frontend/src/shared/annotationLabels.ts` — change both
 * together. Each side has its own test asserting the same truth table; nothing
 * checks the mirror itself, which is the standing gap named in CLAUDE.md
 * ("a counting rule has exactly one home").
 *
 * forgejo#124 phase 6. Until now the annotation UI offered one hardcoded list
 * of flight labels and the deriver understood five of them, so every template
 * the workshop produced was a flight template whatever the document was.
 *
 * ## The vocabulary is borrowed, never invented
 *
 * Each label set is the field list of a reader that already exists, because a
 * second vocabulary beside the first is a vocabulary that drifts:
 *
 *  - flight  — the labels the annotation UI has always offered, which map 1:1
 *              onto `Flight` in `components/Training/types.ts`.
 *  - lodging — `LodgingFieldRules` in
 *              `services/lodging/templates/types.ts` (plan phase 4). A derived
 *              lodging template IS one of those specs, so its labels are that
 *              spec's field names.
 *  - cruise  — `ParsedCruise` in `services/cruiseBookingParser.ts`.
 *  - place   — `PlaceImportCandidate` in `schemas/placeImport.ts`.
 *
 * ## Why two of the four cannot derive anything
 *
 * A label set is not a reader. Annotating a cruise confirmation records
 * ground truth, but nothing in this tree can RUN a derived cruise template: a
 * sailing is a repeating stop list, and the `RepeatingBlockSpec` that would
 * read one is phase 5 of the plan and is not built. There is no document
 * parser for places at all. So those two domains say so — `derivable: false`
 * with a reason — instead of writing a template that would match a document
 * and extract nothing. The plan's own trap list: "a matching template is not
 * an extracting template", and a plausible wrong value gets accepted by habit.
 */

export const WORKSHOP_DOMAINS = ["flight", "lodging", "cruise", "place"] as const;
export type WorkshopDomain = (typeof WORKSHOP_DOMAINS)[number];

/** Which shape the value has, which is what decides how it is read back. */
export type LabelKind = "text" | "date" | "time" | "money" | "currency" | "count" | "reference";

export interface AnnotationLabel {
  /** Stable id. Also the i18n key: `parser:labels.<domain>.<id>`. */
  id: string;
  /** Which group the picker shows it under: `parser:labelGroups.<group>`. */
  group: string;
  kind: LabelKind;
}

export interface WorkshopDomainSpec {
  domain: WorkshopDomain;
  labels: readonly AnnotationLabel[];
  /**
   * Can a template derived from these annotations be run by any reader that
   * exists today? When false, `reason` names the i18n key that says why —
   * `parser:derivation.cannot.<reason>`.
   */
  derivable: boolean;
  reason?: "cruiseNeedsRepeatingBlocks" | "noPlaceDocumentReader";
}

const flightLabels: readonly AnnotationLabel[] = [
  { id: "flightNumber", group: "flight", kind: "text" },
  { id: "airline", group: "flight", kind: "text" },
  { id: "aircraft", group: "flight", kind: "text" },
  { id: "departureCode", group: "route", kind: "text" },
  { id: "arrivalCode", group: "route", kind: "text" },
  { id: "departureDate", group: "route", kind: "date" },
  { id: "departureTime", group: "route", kind: "time" },
  { id: "arrivalDate", group: "route", kind: "date" },
  { id: "arrivalTime", group: "route", kind: "time" },
  { id: "seat", group: "boarding", kind: "text" },
  { id: "seatClass", group: "boarding", kind: "text" },
  { id: "terminal", group: "boarding", kind: "text" },
  { id: "gate", group: "boarding", kind: "text" },
  { id: "boardingGroup", group: "boarding", kind: "text" },
  { id: "pnr", group: "booking", kind: "reference" },
  { id: "ticketNumber", group: "booking", kind: "reference" },
];

/** Exactly the keys of `LodgingFieldRules`, in the order a mail states them. */
const lodgingLabels: readonly AnnotationLabel[] = [
  { id: "hotelName", group: "property", kind: "text" },
  { id: "roomCategory", group: "property", kind: "text" },
  { id: "checkIn", group: "stay", kind: "date" },
  { id: "checkOut", group: "stay", kind: "date" },
  { id: "guests", group: "stay", kind: "count" },
  { id: "address", group: "place", kind: "text" },
  { id: "postcode", group: "place", kind: "text" },
  { id: "city", group: "place", kind: "text" },
  { id: "country", group: "place", kind: "text" },
  { id: "totalPrice", group: "money", kind: "money" },
  { id: "pricePerNight", group: "money", kind: "money" },
  { id: "currency", group: "money", kind: "currency" },
  { id: "confirmationNumber", group: "booking", kind: "reference" },
];

const cruiseLabels: readonly AnnotationLabel[] = [
  { id: "shipName", group: "ship", kind: "text" },
  { id: "cruiseLine", group: "ship", kind: "text" },
  { id: "routeName", group: "ship", kind: "text" },
  { id: "startDate", group: "voyage", kind: "date" },
  { id: "endDate", group: "voyage", kind: "date" },
  { id: "departurePortName", group: "voyage", kind: "text" },
  { id: "arrivalPortName", group: "voyage", kind: "text" },
  { id: "cabinNumber", group: "cabin", kind: "text" },
  { id: "cabinType", group: "cabin", kind: "text" },
  { id: "deck", group: "cabin", kind: "count" },
  { id: "price", group: "money", kind: "money" },
  { id: "currency", group: "money", kind: "currency" },
  { id: "bookingReference", group: "booking", kind: "reference" },
];

const placeLabels: readonly AnnotationLabel[] = [
  { id: "name", group: "property", kind: "text" },
  { id: "category", group: "property", kind: "text" },
  { id: "address", group: "place", kind: "text" },
  { id: "city", group: "place", kind: "text" },
  { id: "country", group: "place", kind: "text" },
  { id: "visitedAt", group: "stay", kind: "date" },
  { id: "notes", group: "property", kind: "text" },
];

export const WORKSHOP_DOMAIN_SPECS: Readonly<Record<WorkshopDomain, WorkshopDomainSpec>> =
  Object.freeze({
    flight: { domain: "flight", labels: flightLabels, derivable: true },
    lodging: { domain: "lodging", labels: lodgingLabels, derivable: true },
    cruise: {
      domain: "cruise",
      labels: cruiseLabels,
      derivable: false,
      reason: "cruiseNeedsRepeatingBlocks",
    },
    place: {
      domain: "place",
      labels: placeLabels,
      derivable: false,
      reason: "noPlaceDocumentReader",
    },
  });

export function isWorkshopDomain(value: string): value is WorkshopDomain {
  return (WORKSHOP_DOMAINS as readonly string[]).includes(value);
}

export function labelsForDomain(domain: WorkshopDomain): readonly AnnotationLabel[] {
  return WORKSHOP_DOMAIN_SPECS[domain].labels;
}

export function isLabelOfDomain(domain: WorkshopDomain, label: string): boolean {
  return WORKSHOP_DOMAIN_SPECS[domain].labels.some((entry) => entry.id === label);
}

/** The groups this domain uses, in the order its labels first mention them. */
export function labelGroupsForDomain(domain: WorkshopDomain): string[] {
  const seen: string[] = [];
  for (const label of WORKSHOP_DOMAIN_SPECS[domain].labels) {
    if (!seen.includes(label.group)) seen.push(label.group);
  }
  return seen;
}
