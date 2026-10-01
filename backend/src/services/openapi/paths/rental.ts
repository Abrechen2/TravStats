/**
 * Car rental endpoints (spec docs/superpowers/specs/2026-10-01-rental-domain-design.md §5).
 *
 * Enveloped like every newer domain (ADR 0001). The write body names stations
 * as objects and times as the station's wall clock; the row that comes back is
 * flat, carries real UTC instants plus each station's zone, and `times` in the
 * ADR 0002 D3 shape.
 */

import { z } from "zod";

import { registry } from "../registry";
import { includedRow, prismaColumns } from "../prismaColumns";
import { errorContent, timeRefused } from "./shared";
import { documentIdsBodySchema } from "../../../schemas/document";
import {
  createRentalSchema,
  updateRentalSchema,
  RENTAL_DISTANCE_SOURCES,
  RENTAL_FUEL_POLICIES,
  RENTAL_INCLUSIONS,
  RENTAL_MILEAGE_POLICIES,
  RENTAL_PAYMENT_TIMINGS,
  RENTAL_SORT_FIELDS,
  RENTAL_STATUSES,
} from "../../../schemas/rental";
import { rentalTimesSchema } from "../../../schemas/times";

const stationErrors = {
  422: {
    description:
      "A station could not be placed (`RENTAL_STATION_UNRESOLVED`, `field` names it), a wall " +
      "clock the station's zone skips (`LOCAL_TIME_NONEXISTENT`) or a place with no zone " +
      "(`TZ_UNRESOLVED`)",
    content: errorContent,
  },
  503: {
    description:
      "The address search did not answer (`RENTAL_GEOCODER_UNAVAILABLE`) — never stored as " +
      '"no such place"',
    content: errorContent,
  },
} as const;

export const rentalBookingSchema = registry.register(
  "RentalBooking",
  z
    .object({
      ...prismaColumns("RentalBooking"),
      id: z.string().uuid(),
      userId: z.string().uuid(),
      provider: z.string().describe("The company whose counter hands over the keys"),
      operatedBy: z.string().nullable().describe("Set only when someone else runs the counter"),
      broker: z
        .string()
        .nullable()
        .describe("OTA, broker or tour operator the booking went through"),
      pickupAirportId: z
        .number()
        .int()
        .nullable()
        .describe("Airport the station sits at, when one"),
      returnAirportId: z.number().int().nullable(),
      pickupIata: z.string().nullable().describe("IATA code of that airport; null otherwise"),
      returnIata: z.string().nullable(),
      pickupCountry: z.string().nullable().describe("ISO 3166-1 alpha-2; null when unknown"),
      returnCountry: z.string().nullable(),
      pickupTimezone: z.string().describe("IANA zone the server derived for the station"),
      returnTimezone: z.string(),
      pickupTime: z.string().datetime().describe("Real UTC instant; `times.pickup` is the reading"),
      returnTime: z.string().datetime(),
      actualPickupTime: z.string().datetime().nullable(),
      actualReturnTime: z.string().datetime().nullable(),
      acrissCode: z.string().nullable().describe("Four-letter ACRISS code, when printed"),
      vehicleTraits: z
        .object({
          transmission: z.enum(["manual", "automatic"]),
          airConditioning: z.boolean(),
        })
        .nullable()
        .describe("Derived from `acrissCode` on read; null without a valid code"),
      distanceKm: z
        .number()
        .int()
        .nullable()
        .describe(
          "Driven km — from the final invoice or a labelled correction; null = unknown, never 0"
        ),
      distanceSource: z.enum(RENTAL_DISTANCE_SOURCES).nullable(),
      finalAmountSource: z
        .enum(["invoice", "user"])
        .nullable()
        .describe("Where `finalAmount` came from; null without one"),
      mileagePolicy: z.enum(RENTAL_MILEAGE_POLICIES).nullable(),
      fuelPolicy: z.enum(RENTAL_FUEL_POLICIES).nullable(),
      paymentTiming: z
        .enum(RENTAL_PAYMENT_TIMINGS)
        .nullable()
        .describe("`package`: inside a tour-operator price — a null price is then normal"),
      price: z.number().nullable().describe("Booked price; null = unknown, never 0"),
      inclusions: z.array(z.enum(RENTAL_INCLUSIONS)),
      status: z
        .enum(RENTAL_STATUSES)
        .describe("Derived from the booked instants; only 'cancelled' is set by a client"),
      oneWay: z
        .boolean()
        .describe("Pickup and return differ — by airport, else by more than 1 km. Derived."),
      rentalDays: z
        .number()
        .int()
        .describe(
          "Calendar days from the pickup day to the return day at the stations; at least 1"
        ),
      cost: z
        .object({
          amount: z.number(),
          currency: z.string(),
          source: z.enum(["final", "booked"]),
        })
        .nullable()
        .describe(
          "What the rental cost: the invoice's final amount, else the booked price; null when neither"
        ),
      userEditedFields: z
        .array(z.string())
        .describe("Fields typed by hand — a later mail of the booking never replaces them"),
      trip: includedRow("trip (id, name, color)").nullable().optional(),
      route: z
        .object({ id: z.string().uuid(), name: z.string().nullable() })
        .nullable()
        .optional()
        .describe("The roadtrip this car was driven on"),
      times: rentalTimesSchema,
    })
    .openapi("RentalBooking")
);

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });

const stationHit = z
  .object({
    kind: z.enum(["airport", "earlier"]),
    airportId: z.number().int().nullable(),
    iata: z.string().nullable(),
    name: z.string(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    lat: z.number(),
    lon: z.number(),
    country: z.string().nullable(),
    timezone: z.string().nullable(),
  })
  .openapi("RentalStationHit");

registry.registerPath({
  method: "get",
  path: "/rentals",
  summary: "List rentals",
  description:
    "One page of the authenticated user's car rentals. `meta.total` is the size of the " +
    "FILTERED set; every sort key carries `id` as a tie-breaker, so paging is stable.",
  tags: ["Rentals"],
  request: {
    query: z.object({
      status: z.enum(RENTAL_STATUSES).optional(),
      q: z
        .string()
        .optional()
        .describe("Free text over provider, broker, numbers, stations and vehicle"),
      year: z.coerce
        .number()
        .int()
        .min(1900)
        .max(2200)
        .optional()
        .describe("Calendar year of the pickup, on the pickup station's calendar"),
      provider: z.string().optional(),
      tripId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      sort: z.enum(RENTAL_SORT_FIELDS).optional(),
      order: z.enum(["asc", "desc"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "One page of rentals",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.array(rentalBookingSchema),
            meta: z.object({
              total: z.number().int().describe("Size of the FILTERED set"),
              limit: z.number().int(),
              offset: z.number().int(),
            }),
          }),
        },
      },
    },
    400: { description: "Invalid query", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/rentals/stations",
  summary: "Search rental stations",
  description:
    "Every airport the query names (exact IATA/ICAO first) and every station the user rented " +
    "from before. An address that is neither goes through the geocoder search.",
  tags: ["Rentals"],
  request: {
    query: z.object({
      q: z.string().min(2).max(100),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: {
      description: "Earlier stations first, then airports",
      content: { "application/json": { schema: envelope(z.array(stationHit)) } },
    },
    400: { description: "Invalid query", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/rentals/{id}",
  summary: "Get a rental",
  tags: ["Rentals"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "The rental",
      content: { "application/json": { schema: envelope(rentalBookingSchema) } },
    },
    404: { description: "Not found (`RENTAL_NOT_FOUND`)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/rentals",
  summary: "Create a rental",
  description:
    "`pickupLocal`/`returnLocal` are the station's wall clock without an offset (or a bare " +
    "day: precision `day`); the server places each station (airport id → IATA → the position " +
    "sent → the address geocoded) and reads the clock in its zone. A station nothing places " +
    "is refused — never stored at a guessed position. Without `returnStation` the car is " +
    "returned where it was picked up. `distanceKm` and `finalAmount` here are labelled " +
    "corrections (`user`); the invoice is their real source.",
  tags: ["Rentals"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createRentalSchema.openapi("RentalCreateInput").and(documentIdsBodySchema),
        },
      },
    },
  },
  responses: {
    ...stationErrors,
    422: { ...stationErrors[422], content: timeRefused.content },
    201: {
      description: "Created",
      content: { "application/json": { schema: envelope(rentalBookingSchema) } },
    },
    400: {
      description: "Validation failed (`RENTAL_INVALID_INPUT`, `RENTAL_RETURN_BEFORE_PICKUP`)",
      content: errorContent,
    },
    404: { description: "Trip or roadtrip not found", content: errorContent },
    429: { description: "Too many rentals created", content: errorContent },
  },
});

registry.registerPath({
  method: "patch",
  path: "/rentals/{id}",
  summary: "Update a rental",
  description:
    "Partial update. A station is replaced whole; `returnStation: null` ties the return to the " +
    "pickup station again. A wall clock not sent keeps the booking's reading, re-read in the " +
    "(possibly new) station's zone. Every field sent is recorded as edited by hand.",
  tags: ["Rentals"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: { "application/json": { schema: updateRentalSchema.openapi("RentalUpdateInput") } },
    },
  },
  responses: {
    ...stationErrors,
    422: { ...stationErrors[422], content: timeRefused.content },
    200: {
      description: "Updated",
      content: { "application/json": { schema: envelope(rentalBookingSchema) } },
    },
    400: { description: "Validation failed", content: errorContent },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/rentals/{id}",
  summary: "Delete a rental",
  tags: ["Rentals"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: errorContent },
  },
});
