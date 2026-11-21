/**
 * A booking as a package (forgejo#430): `routes/trips/bookingPackage.ts`.
 * Bare, like the other booking routes (ADR 0001).
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { bookingSplit } from "./flightBooking";
import { BOOKING_ENTRY_KINDS, packageSplitBodySchema } from "../../../schemas/flightBooking";

import { localDateValueSchema, timeValueSchema } from "../../../shared/time/wire";

/** A flight, ride or rental starts at an instant; a stay or cruise on a calendar day. */
const timeOrDay = z.union([timeValueSchema, localDateValueSchema]).nullable();

const params = z.object({ id: z.string().uuid() });
const notFound = { description: "Not found (`BOOKING_NOT_FOUND`)", content: errorContent };

const bookingPackage = registry.register(
  "BookingPackage",
  z
    .object({
      booking: z.object({
        id: z.string().uuid(),
        pnr: z.string().nullable(),
        operator: z.string().nullable(),
        travellers: z.number().int().nullable(),
        price: z.number().nullable().describe("The one price of everything below; 0 = free"),
        currency: z.string().nullable(),
        tripId: z.string().uuid().nullable(),
        tripName: z.string().nullable(),
      }),
      isPackage: z.boolean().describe("The items span more than one kind"),
      items: z.array(
        z.object({
          kind: z.enum(BOOKING_ENTRY_KINDS),
          id: z.string(),
          label: z.string(),
          date: z.string().datetime().nullable().describe("Legacy mirror of `times.start`"),
          times: z
            .object({ start: timeOrDay })
            .describe("When the entry starts, in the time model's shape"),
          status: z.string(),
          tripId: z.string().uuid().nullable(),
          share: z
            .number()
            .nullable()
            .describe("This item's share of a valid split; null = not split — 'part of a package'"),
        })
      ),
      split: bookingSplit.nullable().describe("Null = not split"),
    })
    .openapi("BookingPackage")
);

const answer = (description: string) => ({
  description,
  content: { "application/json": { schema: bookingPackage } },
});

registry.registerPath({
  method: "get",
  path: "/trips/bookings/{id}",
  summary: "A booking with every entry it sold and its price split (forgejo#430)",
  tags: ["Trips"],
  request: { params },
  responses: { 200: answer("The booking"), 404: notFound },
});

registry.registerPath({
  method: "put",
  path: "/trips/bookings/{id}/split",
  summary: "Split a booking's price across its paying items",
  description:
    "`equal` divides the total largest-remainder in the minor unit; `manual` takes the user's " +
    "amounts, which must name every paying item once (`BOOKING_SPLIT_ITEMS`) and add up to the " +
    "total exactly (`BOOKING_SPLIT_SUM`). Shares are in the booking currency.",
  tags: ["Trips"],
  request: {
    params,
    body: { content: { "application/json": { schema: packageSplitBodySchema } }, required: true },
  },
  responses: {
    200: answer("The booking with its new split"),
    404: notFound,
    409: {
      description: "`BOOKING_PRICE_MISSING` or `BOOKING_SPLIT_SINGLE_SEGMENT`",
      content: errorContent,
    },
    422: { description: "`BOOKING_SPLIT_ITEMS` or `BOOKING_SPLIT_SUM`", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/bookings/{id}/split",
  summary: "Remove a booking's split — back to 'not split'",
  tags: ["Trips"],
  request: { params },
  responses: { 200: answer("The booking, not split"), 404: notFound },
});
