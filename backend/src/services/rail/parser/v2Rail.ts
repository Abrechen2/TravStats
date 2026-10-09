/**
 * Rail consumption of v2 templates (plan 2026-10-09 P4b): the one place a
 * `rail` template's values become a `ParsedRailBooking`. The Deutsche Bahn
 * readers that used to be compiled in — booking mail, Online-Ticket, postal
 * order, connection info, order facts, reservations — are such files now.
 *
 * A template says what it reads with a constant `documentKind`:
 * - `booking`     legs that are rides — new journeys;
 * - `reservation` legs that only attach a seat to rides the user has
 *                 (forgejo#203); a document one of these MATCHES is never
 *                 read as a booking, whatever it prints;
 * - `orderFacts`  no legs: the reference and total of an order mail whose
 *                 itinerary sits in the attached ticket.
 *
 * Values are validated by Zod first (a template is community data). What a
 * leg MEANS is decided here, the same for every operator: a leg needs both
 * stations and a departure; a currency is stated only beside a price; a value
 * the document does not print is null, never a guess.
 */
import { z } from "zod";
import logger from "../../../utils/logger";
import { RAIL_TRAVEL_CLASSES } from "../../../schemas/rail";
import type { TemplateEnvelope } from "../../parsers/templates/v2/envelope";
import { applyTemplate, envelopeMatches } from "../../parsers/templates/v2/runners";
import type { ParsedRailBooking, ParsedRailLeg, RailParseSource } from "./types";

export type RailTemplateKind = "booking" | "reservation" | "orderFacts";

const text = z.string().min(1).nullish();
const localTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .nullish();

const legSchema = z.object({
  depStationName: text,
  arrStationName: text,
  departureLocal: localTime,
  arrivalLocal: localTime,
  trainCategory: text,
  trainNumber: text,
  coach: text,
  seat: text,
  direction: z.enum(["outbound", "return"]).nullish(),
});

const railValuesSchema = z.object({
  documentKind: z.enum(["booking", "reservation", "orderFacts"]),
  source: text,
  bookingReference: text,
  travelClass: z.enum(RAIL_TRAVEL_CLASSES).nullish(),
  tariff: text,
  price: z.number().finite().nonnegative().nullish(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullish(),
  operator: text,
  legs: z.array(legSchema).max(100).optional(),
});
type RailValues = z.infer<typeof railValuesSchema>;

/** What a rail template reads: its constant `documentKind` field. */
export function railTemplateKind(template: TemplateEnvelope): RailTemplateKind | null {
  const kind = template.extraction.fields?.documentKind?.value;
  return kind === "booking" || kind === "reservation" || kind === "orderFacts" ? kind : null;
}

/** `rail:db-confirmation` → `db-confirmation`: the reader name a booking carries. */
export function railTemplateName(template: TemplateEnvelope): string {
  return template.id.slice(template.id.indexOf(":") + 1);
}

function readValues(template: TemplateEnvelope, document: string): RailValues | null {
  if (template.domain !== "rail") return null;
  const application = applyTemplate(template, document);
  if (!application.matched) return null;
  const parsed = railValuesSchema.safeParse(application.values);
  if (parsed.success) return parsed.data;
  logger.warn(
    {
      template: template.id,
      version: template.version,
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    },
    "v2 rail template produced values of the wrong shape — declined"
  );
  return null;
}

function toLeg(leg: z.infer<typeof legSchema>): ParsedRailLeg | null {
  if (!leg.depStationName || !leg.arrStationName || !leg.departureLocal) return null;
  return {
    depStationName: leg.depStationName,
    arrStationName: leg.arrStationName,
    departureLocal: leg.departureLocal,
    arrivalLocal: leg.arrivalLocal ?? null,
    trainCategory: leg.trainCategory ?? null,
    trainNumber: leg.trainNumber ?? null,
    coach: leg.coach ?? null,
    seat: leg.seat ?? null,
    direction: leg.direction ?? null,
  };
}

/** One document read by one booking or reservation template, or null. */
export function applyV2RailTemplate(
  template: TemplateEnvelope,
  document: string
): ParsedRailBooking | null {
  const values = readValues(template, document);
  if (!values || values.documentKind === "orderFacts") return null;
  const legs = (values.legs ?? []).map(toLeg).filter((l): l is ParsedRailLeg => l !== null);
  if (legs.length === 0) return null;
  const price = values.price ?? null;
  return {
    bookingReference: values.bookingReference ?? null,
    travelClass: values.travelClass ?? null,
    tariff: values.tariff ?? null,
    price,
    currency: price !== null ? (values.currency ?? null) : null,
    operator: values.operator ?? null,
    legs,
    source: (values.source ?? railTemplateName(template)) as RailParseSource,
    ...(values.documentKind === "reservation" ? { documentKind: "reservation" as const } : {}),
  };
}

export type RailOrderFacts = Pick<
  ParsedRailBooking,
  "bookingReference" | "price" | "currency" | "travelClass"
>;

/** The reference and total an order mail states; null when it states neither. */
export function applyV2RailOrderFacts(
  template: TemplateEnvelope,
  document: string
): RailOrderFacts | null {
  const values = readValues(template, document);
  if (!values || values.documentKind !== "orderFacts") return null;
  const bookingReference = values.bookingReference ?? null;
  const price = values.price ?? null;
  if (!bookingReference && price === null) return null;
  return {
    bookingReference,
    price,
    currency: price !== null ? (values.currency ?? null) : null,
    travelClass: null,
  };
}

/** The active rail templates, split by what they read, each list in the order given. */
export interface RailTemplateSet {
  bookings: readonly TemplateEnvelope[];
  reservations: readonly TemplateEnvelope[];
  orderFacts: readonly TemplateEnvelope[];
}

export function railTemplateSet(templates: readonly TemplateEnvelope[]): RailTemplateSet {
  const of = (kind: RailTemplateKind) => templates.filter((t) => railTemplateKind(t) === kind);
  return { bookings: of("booking"), reservations: of("reservation"), orderFacts: of("orderFacts") };
}

/** Whether a reservation template RECOGNISES the document — then it is no booking. */
export function isReservationDocument(set: RailTemplateSet, document: string): boolean {
  return set.reservations.some((t) => envelopeMatches(t, document));
}

function firstOf<T>(
  templates: readonly TemplateEnvelope[],
  read: (t: TemplateEnvelope) => T | null
): T | null {
  for (const template of templates) {
    const hit = read(template);
    if (hit) return hit;
  }
  return null;
}

/** The first booking template that reads legs — unless a reservation template claims the document. */
export function readRailBooking(set: RailTemplateSet, document: string): ParsedRailBooking | null {
  if (isReservationDocument(set, document)) return null;
  return firstOf(set.bookings, (t) => applyV2RailTemplate(t, document));
}

export function readRailReservation(
  set: RailTemplateSet,
  document: string
): ParsedRailBooking | null {
  return firstOf(set.reservations, (t) => applyV2RailTemplate(t, document));
}

export function readRailOrderFacts(set: RailTemplateSet, document: string): RailOrderFacts | null {
  return firstOf(set.orderFacts, (t) => applyV2RailOrderFacts(t, document));
}
