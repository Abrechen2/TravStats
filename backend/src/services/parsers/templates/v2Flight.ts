/**
 * Flight consumption of v2 templates (plan 2026-10-09 P4a).
 *
 * A v2 `flight` template extracts a `legs` repeat (and, optionally, scalar
 * fields shared by every leg — a booking code printed once). This adapter is
 * the one place those values become `ParsedBooking`s: Zod-validated first,
 * because a template is community data and a value of the wrong shape is a
 * template defect, then mapped onto the booking keys the v1 engine used, with
 * the same confidence figure (fields read / fields the template defines) and
 * the same `missing` list (flight number and both airports).
 *
 * Leg value names are the v1 selector names, so a v1 template ports field for
 * field: flightNumber, pnr, departureTime, arrivalTime, departureCode,
 * arrivalCode, seat, seatClass, price, currency, taxes, fees, baggage,
 * frequentFlyer, ticketNumber, bookingClassLetter, terminal, gate — plus
 * `arrivalDayOffset`, the "+1" some airlines print after a red-eye's arrival.
 */
import { z } from "zod";
import logger from "../../../utils/logger";
import type { ParsedBooking } from "../../bookingParser";
import type { TemplateEnvelope, TemplateTestInput } from "./v2/envelope";
import { applyTemplate } from "./v2/runners";

const LEG_TO_BOOKING = {
  flightNumber: "flightNumber",
  pnr: "bookingReference",
  departureTime: "departureTime",
  arrivalTime: "arrivalTime",
  departureCode: "departureCode",
  arrivalCode: "arrivalCode",
  seat: "seat",
  seatClass: "seatClass",
  price: "price",
  currency: "currency",
  taxes: "taxes",
  fees: "fees",
  baggage: "baggageAllowance",
  frequentFlyer: "frequentFlyerNumber",
  ticketNumber: "ticketNumber",
  bookingClassLetter: "bookingClassLetter",
  terminal: "terminal",
  gate: "gate",
} as const satisfies Record<string, keyof ParsedBooking>;

type LegKey = keyof typeof LEG_TO_BOOKING;
const LEG_KEYS = Object.keys(LEG_TO_BOOKING) as LegKey[];
const CRITICAL: readonly LegKey[] = ["flightNumber", "departureCode", "arrivalCode"];

const scalar = z
  .union([z.string().min(1), z.number().finite()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? undefined : String(v)));
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "must be YYYY-MM-DDTHH:MM")
  .nullish()
  .transform((v) => v ?? undefined);

const legValuesSchema = z.object({
  flightNumber: scalar,
  pnr: scalar,
  departureTime: localDateTime,
  arrivalTime: localDateTime,
  departureCode: scalar,
  arrivalCode: scalar,
  seat: scalar,
  seatClass: scalar,
  price: scalar,
  currency: scalar,
  taxes: scalar,
  fees: scalar,
  baggage: scalar,
  frequentFlyer: scalar,
  ticketNumber: scalar,
  bookingClassLetter: scalar,
  terminal: scalar,
  gate: scalar,
  arrivalDayOffset: z.number().int().min(-1).max(3).nullish(),
});
type LegValues = z.infer<typeof legValuesSchema>;

const flightValuesSchema = z.object({ legs: z.array(z.record(z.string(), z.unknown())) });

export type V2FlightOutcome =
  { kind: "declined" } | { kind: "nonBooking" } | { kind: "legs"; legs: ParsedBooking[] };

/** `flight:LH-old` → `LH-old`: the name `parserTemplate` carries, as in v1. */
export function flightTemplateName(template: TemplateEnvelope): string {
  return template.id.slice(template.id.indexOf(":") + 1);
}

/** "2023-11-30T13:40" plus one day → "2023-12-01T13:40", on the calendar alone. */
function shiftDays(localDateTimeValue: string, days: number): string {
  const [date, time] = localDateTimeValue.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.toISOString().slice(0, 10)}T${time}`;
}

/** Leg value names the template defines, in the legs repeat or as shared fields. */
function definedKeys(template: TemplateEnvelope): LegKey[] {
  const legs = template.extraction.repeats?.legs;
  const names = new Set([
    ...Object.keys(legs && "fields" in legs ? legs.fields : {}),
    ...Object.keys(template.extraction.fields ?? {}),
  ]);
  return LEG_KEYS.filter((k) => names.has(k));
}

function toBooking(
  leg: LegValues,
  defined: readonly LegKey[],
  parserTemplate: string
): ParsedBooking {
  const booking: ParsedBooking = { missing: [], parserTemplate, parserConfidence: 0 };
  const target = booking as unknown as Record<string, unknown>;
  let read = 0;
  for (const key of defined) {
    const value = leg[key];
    if (value) {
      target[LEG_TO_BOOKING[key]] = value;
      read++;
    } else if (CRITICAL.includes(key)) {
      booking.missing.push(LEG_TO_BOOKING[key]);
    }
  }
  booking.parserConfidence = defined.length > 0 ? Math.round((read / defined.length) * 100) : 0;
  if (booking.bookingReference) booking.pnr = booking.bookingReference;
  if (booking.arrivalTime && leg.arrivalDayOffset) {
    booking.arrivalTime = shiftDays(booking.arrivalTime, leg.arrivalDayOffset);
  }
  return booking;
}

/**
 * Read one document with one v2 flight template: its legs, "not a booking"
 * (the issuer's own cancellation, by `match.notBookingIf`), or a decline.
 */
export function applyV2FlightTemplate(
  template: TemplateEnvelope,
  input: TemplateTestInput
): V2FlightOutcome {
  if (template.domain !== "flight") return { kind: "declined" };
  const application = applyTemplate(template, input);
  if (application.nonBooking) return { kind: "nonBooking" };
  if (!application.matched) return { kind: "declined" };

  const shape = flightValuesSchema.safeParse(application.values);
  const shared = Object.fromEntries(
    Object.entries(application.values).filter(([k]) => k !== "legs")
  );
  const legs = shape.success
    ? shape.data.legs.map((leg) =>
        legValuesSchema.safeParse({
          ...shared,
          ...Object.fromEntries(Object.entries(leg).filter(([, v]) => v !== null)),
        })
      )
    : [];
  const bad = legs.find((l) => !l.success);
  if (!shape.success || bad) {
    const issues = shape.success ? (bad?.error?.issues ?? []) : shape.error.issues;
    logger.warn(
      {
        template: template.id,
        version: template.version,
        issues: issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      "v2 flight template produced values of the wrong shape — declined"
    );
    return { kind: "declined" };
  }
  const defined = definedKeys(template);
  const name = flightTemplateName(template);
  return {
    kind: "legs",
    legs: legs.flatMap((l) => (l.success ? [toBooking(l.data, defined, name)] : [])),
  };
}
