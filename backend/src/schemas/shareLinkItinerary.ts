import { z } from "./zod";
import { localDateValueSchema, timeValueSchema } from "../shared/time/wire";

/**
 * The `itinerary` field of a trip share link (forgejo#302): every entry of the
 * trip in time order, so family knows where the traveller is when — with
 * flight numbers and hotel names, on the local clock of each place (ADR 0002).
 *
 * Strict at every level, like the rest of the public view: the serializer
 * parses its own output through this schema, so a builder that grew a key no
 * schema names fails at home. The shapes have NO member for a booking
 * reference, PNR, seat, room or cabin number, price, document, note,
 * companion or id — there is nothing to fill them into.
 */

/** A flight's phase by the clock — shared with the flight link (`schemas/shareLinks.ts`). */
export const FLIGHT_PHASES = ["scheduled", "inFlight", "landed", "cancelled", "unknown"] as const;

const time = timeValueSchema.nullable();
const day = localDateValueSchema.nullable();

const airport = z.strictObject({
  code: z.string().nullable().describe("IATA, else ICAO"),
  name: z.string().nullable(),
});

const flightItem = z.strictObject({
  kind: z.literal("flight"),
  airline: z.string().nullable(),
  flightNumber: z.string().nullable(),
  from: airport,
  to: airport,
  departure: time.describe("Scheduled departure on the departure airport's clock"),
  arrival: time.describe("Scheduled arrival on the arrival airport's clock"),
  phase: z
    .enum(FLIGHT_PHASES)
    .describe("By the server clock; a reported time wins over the schedule"),
});

const stayItem = z.strictObject({
  kind: z.literal("stay"),
  name: z.string().describe("The lodging's name"),
  address: z.string().nullable().describe("As the owner stored it"),
  city: z.string().nullable(),
  country: z.string().nullable(),
  checkIn: day,
  checkOut: day,
  checkInAt: time.describe("Only where the stay carries a time and the hotel a zone"),
  checkOutAt: time,
});

const cruisePort = z.strictObject({
  dayNumber: z.number().int().describe("Day of the cruise"),
  name: z.string().nullable().describe("Null on a sea day"),
  atSea: z.boolean(),
  day,
  arrival: time,
  departure: time,
});

const cruiseItem = z.strictObject({
  kind: z.literal("cruise"),
  ship: z.string().nullable(),
  cruiseLine: z.string().nullable(),
  start: day,
  end: day,
  ports: z.array(cruisePort),
});

const ride = <K extends "rail" | "bus" | "ferry">(kind: K) =>
  z.strictObject({
    kind: z.literal(kind),
    operator: z.string().nullable(),
    service: z
      .string()
      .nullable()
      .describe("Train category and number, bus line, or ferry vessel name"),
    from: z.string(),
    to: z.string(),
    departure: time,
    arrival: time,
  });

const rentalEnd = z.strictObject({ station: z.string(), at: time });

const rentalItem = z.strictObject({
  kind: z.literal("rental"),
  provider: z.string(),
  pickup: rentalEnd,
  return: rentalEnd,
});

const visitItem = z.strictObject({
  kind: z.literal("visit"),
  name: z.string().describe("The place's name"),
  city: z.string().nullable(),
  at: time.describe("When, on the place's clock, cut to the stored precision"),
});

const stopItem = z.strictObject({
  kind: z.literal("stop"),
  name: z.string().describe("The timeline stop's title"),
  start: time,
  end: time,
});

export const itineraryItemSchema = z.discriminatedUnion("kind", [
  flightItem,
  stayItem,
  cruiseItem,
  ride("rail"),
  ride("bus"),
  ride("ferry"),
  rentalItem,
  visitItem,
  stopItem,
]);
export type ItineraryItem = z.infer<typeof itineraryItemSchema>;

export const itineraryViewSchema = z
  .strictObject({
    items: z.array(itineraryItemSchema),
    now: z
      .strictObject({
        index: z.number().int().min(0).describe("Position in `items`"),
        state: z
          .enum(["inProgress", "next"])
          .describe("In progress by the plan, or — when nothing is — the next entry"),
      })
      .nullable()
      .describe("Computed by the server clock at request time; null when nothing is ahead"),
  })
  .describe(
    "Every entry of the trip in time order, cancelled ones left out (forgejo#302). Never a " +
      "booking reference, seat, room or cabin number, price, document, note, companion or id."
  );
export type ItineraryView = z.infer<typeof itineraryViewSchema>;
