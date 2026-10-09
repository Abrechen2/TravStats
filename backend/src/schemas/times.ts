import { z } from "./zod";
import { localDateValueSchema, timeValueSchema } from "../shared/time/wire";

/**
 * The `times` object each entity carries on the read side (ADR 0002 D3,
 * phase 4): every time value of the row in the shape clients display —
 * `TimeValue` for an instant at a place, `LocalDateValue` for a calendar day.
 *
 * Additive: the legacy fields beside it (`departureTime`, `checkIn`, …) stay
 * until the Companion has moved (companion#24, phase 6). A client that reads
 * `times` never needs a zone library and never computes a zone.
 *
 * A member is null when the row has no such value (a flight without an
 * arrival time, a dateless stay) — never a placeholder.
 *
 * The builders are per domain (`services/<domain>/timesDto.ts`) and typed by
 * these schemas, so the spec and the payload cannot drift apart.
 */

const time = timeValueSchema.nullable();
const day = localDateValueSchema.nullable();

export const flightTimesSchema = z
  .object({
    departure: time,
    arrival: time,
    actualDeparture: time.describe(
      "Off-block as a provider reported it, at the departure airport."
    ),
    actualArrival: time,
    runwayDeparture: time.describe("Wheels-up as a provider reported it."),
    runwayArrival: time,
  })
  .openapi("FlightTimes", {
    description:
      "Scheduled and reported times at their airports. `zoneSource: catalogue` marks a " +
      "flight written before zones were stored, read in today's catalogue zone.",
  });
export type FlightTimes = z.infer<typeof flightTimesSchema>;

export const railTimesSchema = z
  .object({ departure: time, arrival: time, actualDeparture: time, actualArrival: time })
  .openapi("RailTimes", { description: "Planned and actual times at their stations." });
export type RailTimes = z.infer<typeof railTimesSchema>;

/** A bus ride's times — rail's shape under the bus name (the two ends carry rail's columns). */
export const busTimesSchema = z
  .object({ departure: time, arrival: time, actualDeparture: time, actualArrival: time })
  .openapi("BusTimes", { description: "Planned and actual times at their terminals." });
export type BusTimes = z.infer<typeof busTimesSchema>;

export const rentalTimesSchema = z
  .object({
    pickup: time.describe(
      "Booked pickup at the pickup station's clock; precision day without an hour."
    ),
    return: time.describe("Booked return at the return station's clock."),
    actualPickup: time.describe("Pickup as an agreement, an invoice or the user recorded it."),
    actualReturn: time,
    depositPaid: day.describe(
      "The day the deposit was held, as the statement shows it — no zone (forgejo#238)."
    ),
    depositReturned: day.describe("The day the deposit came back; null while it is held."),
  })
  .openapi("RentalTimes", { description: "Booked and actual times at their stations." });
export type RentalTimes = z.infer<typeof rentalTimesSchema>;

export const stayTimesSchema = z
  .object({
    checkIn: day.describe("The check-in day at the hotel; precision month/year for a vague stay."),
    checkOut: day,
    checkInAt: time.describe(
      "Check-in day plus its time on the hotel's clock; null without a time."
    ),
    checkOutAt: time,
  })
  .openapi("StayTimes", { description: "A stay's days and, where known, its hours." });
export type StayTimes = z.infer<typeof stayTimesSchema>;

export const visitTimesSchema = z
  .object({
    visitedAt: time.describe(
      "When the place was visited. Precision `unknown`: the day is kept, the time of day " +
        "could not be established (Q4)."
    ),
  })
  .openapi("VisitTimes");
export type VisitTimes = z.infer<typeof visitTimesSchema>;

export const placeTimesSchema = z
  .object({
    lastVisit: time.describe("The most recent completed visit, as that visit's own TimeValue."),
  })
  .openapi("PlaceTimes");
export type PlaceTimes = z.infer<typeof placeTimesSchema>;

export const cruiseTimesSchema = z
  .object({ start: day, end: day })
  .openapi("CruiseTimes", { description: "Embarkation and disembarkation days at their ports." });
export type CruiseTimes = z.infer<typeof cruiseTimesSchema>;

export const cruiseStopTimesSchema = z
  .object({ date: day, arrival: time, departure: time })
  .openapi("CruiseStopTimes", {
    description: "A port call's day and hours on the port's clock; a sea day has a day only.",
  });
export type CruiseStopTimes = z.infer<typeof cruiseStopTimesSchema>;

export const tripTimesSchema = z.object({ start: day, end: day }).openapi("TripTimes", {
  description:
    "The trip's first and last day — the local days of its first departure and last " +
    "arrival; a span the user typed names no place, so its days carry no zone.",
});
export type TripTimes = z.infer<typeof tripTimesSchema>;

export const tripStopTimesSchema = z.object({ start: time, end: time }).openapi("TripStopTimes", {
  description: "A timeline stop's start and end on the stop's clock.",
});
export type TripStopTimes = z.infer<typeof tripStopTimesSchema>;

export const journalEntryTimesSchema = z
  .object({ day })
  .openapi("JournalEntryTimes", { description: "The day a journal entry is written about." });
export type JournalEntryTimes = z.infer<typeof journalEntryTimesSchema>;

export const roadtripStationTimesSchema = z
  .object({ start: day, end: day })
  .openapi("RoadtripStationTimes", {
    description: "The days of a station's nights, on the station's clock.",
  });
export type RoadtripStationTimes = z.infer<typeof roadtripStationTimesSchema>;

/** Every `times` component by its OpenAPI name — registered in one loop. */
export const TIMES_SCHEMAS = {
  FlightTimes: flightTimesSchema,
  RailTimes: railTimesSchema,
  BusTimes: busTimesSchema,
  RentalTimes: rentalTimesSchema,
  StayTimes: stayTimesSchema,
  VisitTimes: visitTimesSchema,
  PlaceTimes: placeTimesSchema,
  CruiseTimes: cruiseTimesSchema,
  CruiseStopTimes: cruiseStopTimesSchema,
  TripTimes: tripTimesSchema,
  TripStopTimes: tripStopTimesSchema,
  JournalEntryTimes: journalEntryTimesSchema,
  RoadtripStationTimes: roadtripStationTimesSchema,
} as const;
