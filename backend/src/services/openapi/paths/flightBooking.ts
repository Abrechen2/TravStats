import { z } from "zod";

import { registry } from "../registry";
import { errorContent, flightResponse } from "./shared";

/**
 * A flight's booking and its segments (forgejo#218, #219):
 * `routes/flights/booking.ts`. Bare, like every flights router.
 */

const flightParams = z.object({ id: z.string().uuid() });

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
      otherEntries: z
        .number()
        .int()
        .describe("Cruises, train journeys and stays filed on the same booking"),
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
