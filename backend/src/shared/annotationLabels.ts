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
 *  - cruise  — `ParsedCruise` in `services/cruiseBookingParser.ts`, plus the
 *              three ITINERARY labels (`stopDate`, `stopPort`, `seaDay`): one
 *              marked row of the port list, which the deriver generalises into
 *              the per-line pattern of a v2 `stops` repeat.
 *  - place   — `PlaceImportCandidate` in `schemas/placeImport.ts`.
 *  - package — the package contract, `services/trip/package/contract.ts`.
 *
 * ## Every domain derives (forgejo#124)
 *
 * A label set is not a reader, and until 2026-10-10 two of the four had none:
 * a sailing is a repeating stop list nothing could read, and there was no
 * document parser for places at all. The v2 template engine reads repeating
 * blocks now, so a cruise annotation becomes a v2 envelope with a `stops`
 * repeat, and a place annotation one that `services/places/v2Place.ts` turns
 * into a place import candidate. `derivable` and `reason` stay, because the
 * next domain may again have labels before it has a reader — and then it says
 * so instead of writing a template that would match a document and extract
 * nothing ("a matching template is not an extracting template").
 */

export const WORKSHOP_DOMAINS = ["flight", "lodging", "cruise", "place", "package"] as const;
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
  reason?: "notDerivable";
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
  // One row of the port list, marked once: the date and the port on the same
  // line. `seaDay` is optional — the word this line prints on a day at sea.
  { id: "stopDate", group: "itinerary", kind: "date" },
  { id: "stopPort", group: "itinerary", kind: "text" },
  { id: "seaDay", group: "itinerary", kind: "text" },
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

/**
 * A tour operator's documents (forgejo#124) — the package contract's names
 * (`backend/src/services/trip/package/contract.ts`). The booking fields are
 * marked once; ONE flight row and ONE hotel row are marked value by value,
 * and the deriver turns each into the repeat that reads every row like it.
 * Booking reference and issue date are what the contract requires.
 */
const packageLabels: readonly AnnotationLabel[] = [
  { id: "bookingReference", group: "booking", kind: "reference" },
  { id: "issuedOn", group: "booking", kind: "date" },
  { id: "tripName", group: "packageTrip", kind: "text" },
  { id: "startDate", group: "packageTrip", kind: "date" },
  { id: "endDate", group: "packageTrip", kind: "date" },
  { id: "travellers", group: "packageTrip", kind: "count" },
  { id: "totalPrice", group: "money", kind: "money" },
  { id: "currency", group: "money", kind: "currency" },
  { id: "flightNumber", group: "flightRow", kind: "text" },
  { id: "flightDate", group: "flightRow", kind: "date" },
  { id: "flightDepIata", group: "flightRow", kind: "text" },
  { id: "flightDepCity", group: "flightRow", kind: "text" },
  { id: "flightDepTime", group: "flightRow", kind: "time" },
  { id: "flightArrIata", group: "flightRow", kind: "text" },
  { id: "flightArrCity", group: "flightRow", kind: "text" },
  { id: "flightArrTime", group: "flightRow", kind: "time" },
  { id: "stayName", group: "stayRow", kind: "text" },
  { id: "stayCity", group: "stayRow", kind: "text" },
  { id: "stayCheckIn", group: "stayRow", kind: "date" },
  { id: "stayCheckOut", group: "stayRow", kind: "date" },
];

export const WORKSHOP_DOMAIN_SPECS: Readonly<Record<WorkshopDomain, WorkshopDomainSpec>> =
  Object.freeze({
    flight: { domain: "flight", labels: flightLabels, derivable: true },
    lodging: { domain: "lodging", labels: lodgingLabels, derivable: true },
    cruise: { domain: "cruise", labels: cruiseLabels, derivable: true },
    place: { domain: "place", labels: placeLabels, derivable: true },
    package: { domain: "package", labels: packageLabels, derivable: true },
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

/** The label `id` of this domain, or undefined when the domain has none by that name. */
export function labelOfDomain(domain: WorkshopDomain, id: string): AnnotationLabel | undefined {
  return WORKSHOP_DOMAIN_SPECS[domain].labels.find((entry) => entry.id === id);
}
