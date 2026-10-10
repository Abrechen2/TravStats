/**
 * Booking endpoints — `routes/trips/tripBookings.ts`, mounted at `/trips`.
 * Moved out of `trips.ts` with the deadlines (forgejo#285), which gave the
 * booking a documented response of its own. Bare, like trips (ADR 0001).
 */

import { z } from "zod";

import { registry } from "../registry";
import { prismaColumns } from "../prismaColumns";
import { errorContent, timeRefused } from "./shared";
import { deadlineDayColumns } from "./deadlineColumns";
import { bookingTimesSchema } from "../../../schemas/times";
import {
  createBookingSchema,
  updateBookingSchema,
  bookingFlightsSchema,
  bookingEntriesSchema,
} from "../../../schemas/trip";

const bookingCreateInput = registry.register(
  "BookingCreateInput",
  createBookingSchema.openapi("BookingCreateInput")
);
const bookingUpdateInput = registry.register(
  "BookingUpdateInput",
  updateBookingSchema.openapi("BookingUpdateInput")
);

const booking = registry.register(
  "Booking",
  z
    .object({
      ...prismaColumns("Booking"),
      id: z.string().uuid(),
      tripId: z.string().uuid().nullable(),
      bookedOn: z
        .string()
        .datetime()
        .nullable()
        .describe("The day it was booked, as the UTC midnight of that day (legacy shape)"),
      freeCancellationUntil: z
        .string()
        .datetime()
        .nullable()
        .describe(
          "Real UTC instant of the free-cancellation deadline; `times.freeCancellationUntil` " +
            "is the reading on its zone (`freeCancellationZone`)"
        ),
      ...deadlineDayColumns,
      times: bookingTimesSchema,
    })
    .describe(
      "One payment covering several things — the flight and the hotel on one reference — " +
        "with its deadlines (forgejo#285)."
    )
    .openapi("Booking")
);

const bookingBody = z.object({ booking });
const tripId = z.object({ id: z.string().uuid() });
const deleted = { description: "Deleted" };
const notFound = { description: "Not found", content: errorContent };
const badInput = { description: "Invalid input", content: errorContent };

registry.registerPath({
  method: "post",
  path: "/trips/bookings",
  summary: "Create a booking",
  description:
    "A booking is one payment covering several things — the flight and the hotel " +
    "on one reference. Trip cost counts a booking once, and counts flights and " +
    "cruises carrying a price but no booking separately, so neither is doubled.",
  tags: ["Trips"],
  request: {
    body: { content: { "application/json": { schema: bookingCreateInput } }, required: true },
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: bookingBody } },
    },
    400: badInput,
    422: timeRefused,
  },
});

registry.registerPath({
  method: "patch",
  path: "/trips/bookings/{id}",
  summary: "Update a booking",
  description:
    "Reference, price, currency, operator, travellers and booking day (which re-dates the " +
    "FX snapshot), and the trip it belongs to (`tripId`; null takes it off its trip). A trip " +
    "that is not the caller's answers 404 `TRIP_NOT_FOUND`. Its entries stay where they are. " +
    "Deadlines (forgejo#285): absent leaves one alone, null clears it.",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: bookingUpdateInput } }, required: true },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: bookingBody } },
    },
    400: badInput,
    404: notFound,
    422: timeRefused,
  },
});

registry.registerPath({
  method: "post",
  path: "/trips/bookings/{id}/flights",
  summary: "File existing flights on a booking",
  description:
    "Sets the booking on every named flight. A flight on no trip joins the booking's trip; " +
    "one already on another trip keeps it. All or nothing: an id that is not the caller's " +
    "answers 404 `FLIGHT_NOT_FOUND` and files none; another account's booking answers 404 " +
    "`BOOKING_NOT_FOUND`.",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: {
      content: { "application/json": { schema: bookingFlightsSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Filed",
      content: {
        "application/json": {
          schema: z.object({ bookingId: z.string().uuid(), count: z.number().int() }),
        },
      },
    },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "put",
  path: "/trips/bookings/{id}/entries",
  summary: "Set the flights, stays and cruises a booking covers",
  description:
    "Each list given replaces that kind's set (an entry left out leaves the booking); an " +
    "absent list is untouched. An entry on no trip joins the booking's trip. All or nothing: " +
    "an id that is not the caller's answers 404 and changes nothing (#356).",
  tags: ["Trips"],
  request: {
    params: tripId,
    body: { content: { "application/json": { schema: bookingEntriesSchema } }, required: true },
  },
  responses: {
    200: {
      description: "Filed",
      content: {
        "application/json": {
          schema: z.object({
            bookingId: z.string().uuid(),
            flights: z.number().int(),
            stays: z.number().int(),
            cruises: z.number().int(),
          }),
        },
      },
    },
    400: badInput,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/trips/bookings/{id}",
  summary: "Delete a booking",
  description: "Its flights, stays and cruises are kept and belong to no booking any more.",
  tags: ["Trips"],
  request: { params: tripId },
  responses: { 204: deleted, 404: notFound },
});
