import { z } from "zod";

import { registry } from "../registry";
import { errorContent, flightResponse } from "./shared";
import { BOOKING_SPLIT_METHODS, bookingSplitBodySchema } from "../../../schemas/flightBooking";

/**
 * A flight's booking and its segments (forgejo#218, #219):
 * `routes/flights/booking.ts`. Bare, like every flights router.
 */

const flightParams = z.object({ id: z.string().uuid() });

const bookingSplit = registry.register(
  "FlightBookingSplit",
  z
    .object({
      method: z.enum(BOOKING_SPLIT_METHODS),
      price: z.number().describe("The booking total the split was computed from"),
      currency: z.string().nullable(),
      shares: z
        .array(z.object({ flightId: z.string(), amount: z.number() }))
        .describe("One per segment; they sum to `price` to the currency's minor unit"),
      staleReason: z
        .enum(["price", "currency", "segments"])
        .nullable()
        .describe("Null while the split still describes the booking; else what changed since"),
    })
    .describe("DISPLAY ONLY. No cost total reads it — totals count the booking price once, all-in.")
    .openapi("FlightBookingSplit")
);

export const flightBookingSummary = registry.register(
  "FlightBookingSummary",
  z
    .object({
      id: z.string().uuid(),
      pnr: z.string().nullable(),
      price: z
        .number()
        .nullable()
        .describe(
          "The booking's all-in total. Counted ONCE for the whole booking; 0 = free, null = no total recorded"
        ),
      currency: z.string().nullable(),
      tripId: z
        .string()
        .uuid()
        .nullable()
        .describe(
          "The trip the BOOKING belongs to — where its price is edited; may differ from a segment's trip"
        ),
      tripName: z.string().nullable(),
      otherEntries: z
        .number()
        .int()
        .describe("Cruises, train journeys and stays filed on the same booking"),
      split: bookingSplit.nullable().describe("The optional split across the segments, or null"),
    })
    .openapi("FlightBookingSummary")
);

export const flightBookingAnswer = z.object({
  booking: flightBookingSummary.nullable().describe("Null when the flight is linked to no booking"),
  segments: z
    .array(flightResponse)
    .describe(
      "Every flight LINKED to the booking (same bookingId), by stored departure instant then id. " +
        "Flights that only share a PNR string are not included."
    ),
});

registry.registerPath({
  method: "get",
  path: "/flights/{id}/booking",
  summary: "A flight's booking and its flight segments",
  tags: ["Flights"],
  request: { params: flightParams },
  responses: {
    200: {
      description: "The booking, or null, and its segments",
      content: { "application/json": { schema: flightBookingAnswer } },
    },
    404: { description: "Flight not found — `code: FLIGHT_NOT_FOUND`", content: errorContent },
  },
});

const splitRefusals = {
  404: {
    description:
      "Flight not found (`FLIGHT_NOT_FOUND`) or linked to no booking (`BOOKING_NOT_FOUND`)",
    content: errorContent,
  },
};

registry.registerPath({
  method: "put",
  path: "/flights/{id}/booking/split",
  summary: "Split the booking's price across its flight segments",
  description:
    "Stores a display-only split, largest-remainder to the minor unit, so the shares sum to the " +
    "total exactly. Never writes a flight's price columns; totals keep counting the booking once.",
  tags: ["Flights"],
  request: {
    params: flightParams,
    body: { content: { "application/json": { schema: bookingSplitBodySchema } } },
  },
  responses: {
    200: {
      description: "The booking with its new split, and its segments",
      content: { "application/json": { schema: flightBookingAnswer } },
    },
    ...splitRefusals,
    409: {
      description:
        "`BOOKING_PRICE_MISSING`, `BOOKING_SPLIT_SINGLE_SEGMENT` or `BOOKING_SPLIT_MIXED`",
      content: errorContent,
    },
    422: {
      description: "`BOOKING_SPLIT_DISTANCE_UNKNOWN`: a segment has no route distance",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/flights/{id}/booking/split",
  summary: "Remove the booking's price split",
  description: "Idempotent: answers the booking without a split either way.",
  tags: ["Flights"],
  request: { params: flightParams },
  responses: {
    200: {
      description: "The booking without a split, and its segments",
      content: { "application/json": { schema: flightBookingAnswer } },
    },
    ...splitRefusals,
  },
});
