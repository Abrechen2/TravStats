/**
 * Car rental endpoints (spec docs/superpowers/specs/2026-10-01-rental-domain-design.md §5).
 *
 * Enveloped like every newer domain (ADR 0001). The write body names stations
 * as objects and times as the station's wall clock; the row that comes back is
 * flat, carries real UTC instants plus each station's zone, and `times` in the
 * ADR 0002 D3 shape.
 */

import { z } from "zod";
import { rentalExtraStatsSchema } from "./rentalStatsExtra";
import { rentalStatsQuerySchema } from "../../../routes/rental/stats";

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
import { rentalImportSchema } from "../../../schemas/rentalImport";
import { timeValueSchema } from "../../../shared/time/wire";

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
      licensePlate: z
        .string()
        .nullable()
        .describe("The car's licence plate as typed — free text, no format check; null = unknown"),
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
      odometerOutKm: z
        .number()
        .int()
        .nullable()
        .describe(
          "Odometer at pick-up, km — from the invoice, an agreement or typed; null = not read. " +
            "With `odometerInKm` and no `distanceKm`, the driven km are in − out; one reading " +
            "alone gives none"
        ),
      odometerInKm: z
        .number()
        .int()
        .nullable()
        .describe("Odometer at return, km; null = not read. Never below `odometerOutKm`"),
      finalAmountSource: z
        .enum(["invoice", "user", "cancellationFee"])
        .nullable()
        .describe(
          "Where `finalAmount` came from; `cancellationFee` on a cancelled rental; null without one"
        ),
      lastMailSentAt: z
        .string()
        .datetime()
        .nullable()
        .describe(
          "Send time of the newest provider mail applied; an older mail only fills empty fields"
        ),
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
          source: z.enum(["final", "booked", "cancellationFee"]),
        })
        .nullable()
        .describe(
          "What the rental cost: the invoice's final amount, else the booked price; for a " +
            "cancelled rental only its cancellation fee; null when none is known"
        ),
      depositAmount: z
        .number()
        .nullable()
        .describe(
          "Deposit held at the counter, in `depositCurrency` — money held, NEVER a cost: no " +
            "total or statistic reads it. Null = none recorded"
        ),
      depositCurrency: z
        .string()
        .nullable()
        .describe("The deposit's own currency; may differ from the price's, never converted"),
      depositPaidOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .describe("Day the deposit was held (`times.depositPaid`)"),
      depositReturnedOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .describe("Day it came back; null while held (`times.depositReturned`)"),
      depositReturnedAmount: z
        .number()
        .nullable()
        .describe("What came back; below `depositAmount` = a partial refund, the rest outstanding"),
      priceSource: z
        .enum(["booking", "user"])
        .nullable()
        .describe(
          "Where the booked `price` came from: the booking mail it was imported from, or typed " +
            "by hand. An invoice never writes it, so it stays beside `finalAmount`; null without a price"
        ),
      invoiceFees: z
        .array(
          z.object({
            label: z.string().describe("As the invoice prints it"),
            amount: z.number(),
            currency: z.string().describe("ISO 4217"),
          })
        )
        .describe(
          "Single fee lines of the invoice the user took over (forgejo#237). Already part of " +
            "`finalAmount` — they explain the difference to `price` and are never added to `cost`"
        ),
      invoiceMissing: z
        .boolean()
        .describe(
          "Returned, and no driven km yet — not from an invoice, a correction or both odometer " +
            "readings — remind (D11 b)"
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

const importEnvelope = z.object({
  success: z.literal(true),
  data: rentalBookingSchema,
  meta: z.object({
    outcome: z
      .enum(["created", "updated", "unchanged", "stale", "cancelled", "invoiced"])
      .describe(
        "What the document did; `stale`: an older mail than the newest applied, nothing overwritten"
      ),
  }),
});

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
              summary: z
                .object({
                  rentals: z.number().int(),
                  days: z.number().int().describe("Days of every rental not cancelled"),
                  providers: z.number().int(),
                })
                .describe("The summary strip's figures over the whole FILTERED set, not this page"),
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
    "corrections (`user`); the invoice is their real source. Each of the four wall clocks " +
    "(`pickupLocal`, `returnLocal`, `actualPickupLocal`, `actualReturnLocal`) has its own fold " +
    "key (`pickupFold`, `returnFold`, `actualPickupFold`, `actualReturnFold`): `later` picks the " +
    "second occurrence of a repeated autumn hour, absent or null the earlier. Any other " +
    "`…Fold` key is refused (`RENTAL_INVALID_INPUT`, `field` names it).",
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
      description:
        "Validation failed (`RENTAL_INVALID_INPUT`, `RENTAL_RETURN_BEFORE_PICKUP`, " +
        "`RENTAL_ACTUAL_RETURN_BEFORE_PICKUP` — the actual return before the actual pickup, " +
        "compared as instants, a day-only end standing for its whole day; " +
        "`RENTAL_ODOMETER_REVERSED` — the return odometer below the pick-up one; " +
        "`RENTAL_DEPOSIT_RETURN_EXCEEDS` — more of the deposit back than held; " +
        "`RENTAL_DEPOSIT_RETURNED_BEFORE_PAID`)",
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
    "(possibly new) station's zone. A field is recorded as edited by hand only when the sent " +
    "value differs from the stored one; a value re-sent unchanged keeps its source (the " +
    "booking's price, an invoice's km and amount) and re-derives nothing. A key " +
    "not sent is unchanged — never cleared; a fold is read only beside its own wall clock.",
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
    400: {
      description:
        "Validation failed; the deposit rules (`RENTAL_DEPOSIT_RETURN_EXCEEDS`, " +
        "`RENTAL_DEPOSIT_RETURNED_BEFORE_PAID`, an amount without `depositCurrency`) are held " +
        "against the merged row; `RENTAL_ODOMETER_REVERSED` when the merged row's return odometer " +
        "is below the pick-up one; `RENTAL_ACTUAL_RETURN_BEFORE_PICKUP` when the merged row's " +
        "actual return precedes its actual pickup (`field`: the actual end this write sent)",
      content: errorContent,
    },
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

registry.registerPath({
  method: "post",
  path: "/rentals/import",
  summary: "Apply one reviewed rental document",
  description:
    "What a parse (`domain: rental`) read, after the user answered what it could not. A " +
    "confirmation creates a rental — or, when the account already holds its provider + " +
    "booking number, updates it, never overwriting a field the user edited and never a richer " +
    "value with a poorer one. A cancellation sets `cancelled` (never a delete); an invoice " +
    "fills the driven km (`distanceSource: invoice`), the car driven, the actual times and the " +
    "final amount. Neither of those two ever creates a rental: an unknown booking is " +
    "`RENTAL_UNKNOWN_BOOKING` and nothing is written. A cancellation's `fee` becomes the " +
    "cancelled rental's cost, flagged `cancellationFee`. With `mailSentAt` (the mail's own " +
    "send time) the newest mail's data stands whatever the import order: an older one only " +
    "fills empty fields and an older cancellation does not cancel (`stale`). An invoice's " +
    "`adopt` names the parts the review took over (`finalAmount`, `vehicleDriven`, " +
    "`odometer`, `distance`, `actualTimes`); `false` leaves that part as it is, absent takes " +
    "it. `adopt.fees` lists the indexes of `invoice.fees` taken over (absent = all, `[]` = " +
    "none; an index with no line is `RENTAL_INVOICE_FEE_UNKNOWN`); they are stored as " +
    "`invoiceFees`, replacing an earlier invoice's, and are never added to the cost. The " +
    "booked `price` is never written by an invoice.",
  tags: ["Rentals"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: rentalImportSchema.openapi("RentalImportInput").and(documentIdsBodySchema),
        },
      },
    },
  },
  responses: {
    ...stationErrors,
    422: { ...stationErrors[422], content: timeRefused.content },
    201: {
      description: "A new rental from a confirmation",
      content: { "application/json": { schema: importEnvelope } },
    },
    200: {
      description: "An existing rental updated, cancelled or completed from its invoice",
      content: { "application/json": { schema: importEnvelope } },
    },
    400: { description: "Validation failed", content: errorContent },
    404: {
      description: "No rental with this booking number (`RENTAL_UNKNOWN_BOOKING`)",
      content: errorContent,
    },
    409: {
      description:
        "The invoice's km differ from a figure the user typed (`RENTAL_INVOICE_KM_CONFLICT`); " +
        "send `replaceUserDistance: true` once the user chose the invoice's",
      content: errorContent,
    },
  },
});

const rentalStatsSchema = z
  .object({
    rentals: z.number().int().describe("Completed rentals in scope"),
    days: z.number().int().describe("Rental days on the stations' local calendars"),
    oneWay: z.number().int(),
    byYear: z.array(
      z.object({ year: z.number().int(), rentals: z.number().int(), days: z.number().int() })
    ),
    providers: z
      .array(z.object({ provider: z.string(), rentals: z.number().int(), days: z.number().int() }))
      .describe("Ranked by rental days; the counter's company, never the broker"),
    brokers: z.array(z.object({ broker: z.string(), rentals: z.number().int() })),
    countries: z.array(z.string()).describe("ISO codes of pickup and return stations only"),
    costPerDay: z
      .array(
        z.object({
          currency: z.string(),
          perDay: z.number(),
          rentals: z.number().int(),
          days: z.number().int(),
        })
      )
      .describe("Per currency; a rental without a known cost is out of the sample, never 0"),
    km: z
      .object({
        total: z.number().int().nullable().describe("Null when no rental has km yet"),
        covered: z.number().int().describe("Rentals the total is made of"),
        of: z.number().int().describe("Rentals in scope"),
      })
      .describe("Km only from invoices or labelled corrections"),
    cancellationFees: z
      .array(z.object({ currency: z.string(), amount: z.number(), rentals: z.number().int() }))
      .describe("Fees billed for cancelled rentals, per currency — never a rental-day cost"),
    extra: rentalExtraStatsSchema,
  })
  .openapi("RentalStats");

registry.registerPath({
  method: "get",
  path: "/rentals/stats",
  summary: "Rental statistics",
  description: "Completed rentals only, on the stations' calendars (rental spec §7.4).",
  tags: ["Rentals"],
  request: { query: rentalStatsQuerySchema },
  responses: {
    200: {
      description: "The figures",
      content: { "application/json": { schema: envelope(rentalStatsSchema) } },
    },
    400: { description: "Invalid query", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/rentals/{id}/suggestions",
  summary: "Trips and roadtrips a rental could belong to",
  description:
    "Trips whose span overlaps the rental's local days, and roadtrips with a car-like vehicle " +
    "in those days. Offered only — nothing is linked by this call.",
  tags: ["Rentals"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "The suggestions",
      content: {
        "application/json": {
          schema: envelope(
            z.object({
              trips: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
              roadtrips: z.array(
                z.object({
                  id: z.string().uuid(),
                  name: z.string(),
                  vehicle: z.string().nullable(),
                  vehicleName: z.string().nullable(),
                  hasRental: z.boolean(),
                })
              ),
            })
          ),
        },
      },
    },
    404: { description: "Not found", content: errorContent },
  },
});

const stationOfferPoint = z.object({ name: z.string(), lat: z.number(), lon: z.number() });

registry.registerPath({
  method: "post",
  path: "/rentals/{id}/roadtrip",
  summary: "Confirm (or remove) the roadtrip this car was driven on",
  description:
    "Sets `routeId`; an empty roadtrip vehicle name takes the booked group. The pickup and " +
    "return come back as `meta.stationOffer` — offered as the roadtrip's first and last " +
    "station, never written into it. `routeId: null` removes the link.",
  tags: ["Rentals"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        "application/json": { schema: z.object({ routeId: z.string().uuid().nullable() }) },
      },
    },
  },
  responses: {
    200: {
      description: "The rental",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: rentalBookingSchema,
            meta: z.object({
              stationOffer: z
                .object({ first: stationOfferPoint, last: stationOfferPoint })
                .nullable(),
            }),
          }),
        },
      },
    },
    404: { description: "Rental or roadtrip not found", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/rentals/invoice-reminders",
  summary: "Returned rentals whose km wait for their invoice",
  description:
    "Completed within the last 60 days and no km yet (D11 b). One entry per rental, so a " +
    "client can say which one; the rental beta switch is the client's to apply.",
  tags: ["Rentals"],
  responses: {
    200: {
      description: "The reminders, most recent return first",
      content: {
        "application/json": {
          schema: envelope(
            z.array(
              z.object({
                rentalId: z.string().uuid(),
                provider: z.string(),
                confirmationNumber: z.string().nullable(),
                returnStationName: z.string(),
                returnedAt: timeValueSchema,
                reason: z.literal("invoiceMissing"),
              })
            )
          ),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/rentals/providers",
  summary: "Common rental providers",
  description:
    "The catalogue behind the provider field's suggestions (forgejo#196), in suggestion " +
    "order. The field stays free text; this list only saves typing.",
  tags: ["Rentals"],
  responses: {
    200: {
      description: "Providers",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.array(z.object({ id: z.string(), name: z.string() })),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/rentals/providers/logo",
  summary: "A rental provider's logo",
  description:
    "Looked up only for a catalogued provider, on its own website first, then an icon " +
    "service asked about the same domain. 404 for an unknown provider or when no source " +
    "has a logo — the client draws a monogram then; there is never a stand-in image.",
  tags: ["Rentals"],
  request: { query: z.object({ name: z.string() }) },
  responses: {
    200: { description: "Image bytes", content: { "image/*": { schema: z.string() } } },
    400: { description: "No provider name" },
    404: { description: "No logo for this provider" },
  },
});
