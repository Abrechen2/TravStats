/**
 * Public API path registration.
 *
 * The goal is intentionally NOT 100% endpoint coverage — only the
 * surfaces an external consumer (AI agent, automation script, third-
 * party app) actually needs:
 *
 *   - flights:    list / get / create / update / delete
 *   - trips:      list / get / create
 *   - airports:   search by IATA/ICAO/name
 *   - stats:      summary + per-domain rollups
 *   - tokens:     create / list / revoke (cookie-only — disclosed for
 *                 completeness, never callable from a PAT)
 *
 * Internal-only routes (admin/*, parser-templates, parse-logs,
 * boarding-pass-parse, training, diagnostic exports) are deliberately
 * omitted — they're tied to the web UI and not stable contracts.
 *
 * Each path here is registered using a wrapped/cleaned Zod schema.
 * Where the live request schema embeds Express-specific transforms
 * (e.g. emptyStringToUndefined), we use a public-facing `inputSchema`
 * so the OpenAPI consumer doesn't see the internal coercion noise.
 */

import { z } from "zod";

import { registry } from "./registry";
import { createFlightSchema, updateFlightSchema, airportSchema } from "../../schemas/flight";
import {
  apiTokenScopeSchema,
  createApiTokenSchema,
  sanitizedApiTokenSchema,
  createdApiTokenSchema,
} from "../../schemas/apiToken";

/* ─────────────────────────── shared schemas ─────────────────────────── */

const errorResponse = registry.register(
  "Error",
  z
    .object({
      error: z.string().openapi({ example: "Invalid input" }),
      details: z.array(z.string()).optional(),
    })
    .openapi("Error")
);

const flightCreateInput = registry.register(
  "FlightCreateInput",
  createFlightSchema.openapi("FlightCreateInput")
);

const flightUpdateInput = registry.register(
  "FlightUpdateInput",
  updateFlightSchema.openapi("FlightUpdateInput")
);

const flightResponse = registry.register(
  "Flight",
  z
    .object({
      id: z.string().uuid(),
      userId: z.string().uuid(),
      airline: z.string().nullable(),
      operatingAirline: z.string().nullable(),
      flightNumber: z.string().nullable(),
      aircraft: z.string().nullable(),
      depIata: z.string().nullable(),
      depIcao: z.string().nullable(),
      depName: z.string().nullable(),
      depLat: z.number(),
      depLon: z.number(),
      arrIata: z.string().nullable(),
      arrIcao: z.string().nullable(),
      arrName: z.string().nullable(),
      arrLat: z.number(),
      arrLon: z.number(),
      departureTime: z.string().datetime().nullable(),
      arrivalTime: z.string().datetime().nullable(),
      status: z.string(),
      seatNumber: z.string().nullable(),
      seatClass: z.string().nullable(),
      gate: z.string().nullable(),
      terminal: z.string().nullable(),
      bookingReference: z.string().nullable(),
      ticketNumber: z.string().nullable(),
      price: z.number().nullable(),
      currency: z.string().nullable(),
      taxes: z.number().nullable(),
      fees: z.number().nullable(),
      category: z.string().nullable(),
      tags: z.array(z.string()),
      companions: z.array(z.string()),
      notes: z.string().nullable(),
      createdAt: z.string().datetime(),
    })
    .openapi("Flight")
);

const airportResponse = registry.register(
  "Airport",
  z
    .object({
      id: z.number(),
      iata: z.string().nullable(),
      icao: z.string().nullable(),
      name: z.string(),
      city: z.string().nullable(),
      country: z.string().nullable(),
      lat: z.number(),
      lon: z.number(),
      timezone: z.string().nullable(),
      isClosed: z.boolean(),
    })
    .openapi("Airport")
);

const tripResponse = registry.register(
  "Trip",
  z
    .object({
      id: z.string().uuid(),
      userId: z.string().uuid(),
      name: z.string().nullable(),
      description: z.string().nullable(),
      startDate: z.string().datetime().nullable(),
      endDate: z.string().datetime().nullable(),
      createdAt: z.string().datetime(),
    })
    .openapi("Trip")
);

void airportSchema; // exported for consumers; not registered as standalone

registry.register("ApiTokenScope", apiTokenScopeSchema.openapi("ApiTokenScope"));
registry.register("CreateApiTokenInput", createApiTokenSchema.openapi("CreateApiTokenInput"));
registry.register("ApiToken", sanitizedApiTokenSchema.openapi("ApiToken"));
registry.register("CreatedApiToken", createdApiTokenSchema.openapi("CreatedApiToken"));

/* ─────────────────────────── path helpers ─────────────────────────── */

const errorContent = {
  "application/json": { schema: errorResponse },
};

/* ───────────────────────────── flights ──────────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/flights",
  summary: "List flights",
  description:
    "Returns the authenticated user's flights, newest departure first. " +
    "Pagination via `limit` (default 50, max 500) and `offset`.",
  tags: ["Flights"],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      status: z.string().optional().describe("Filter to a single flight status"),
      year: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of flights",
      content: {
        "application/json": {
          schema: z.object({
            flights: z.array(flightResponse),
            total: z.number(),
          }),
        },
      },
    },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/flights/{id}",
  summary: "Get a single flight",
  tags: ["Flights"],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Flight",
      content: { "application/json": { schema: flightResponse } },
    },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/flights",
  summary: "Create a flight",
  description:
    "Creates a new flight. Pass `?merge=true` to enrich an existing matching " +
    "flight (same flightNumber + departureTime ± window) instead of creating " +
    "a duplicate row — empty fields on the existing flight are filled, " +
    "non-empty fields are preserved. Pass `?force=true` to skip duplicate " +
    "detection and always create.",
  tags: ["Flights"],
  request: {
    query: z.object({
      merge: z.enum(["true", "false"]).optional(),
      force: z.enum(["true", "false"]).optional(),
    }),
    body: {
      content: { "application/json": { schema: flightCreateInput } },
    },
  },
  responses: {
    201: {
      description: "Flight created",
      content: {
        "application/json": {
          schema: z.object({
            flight: flightResponse,
            mergedFields: z.array(z.string()).optional(),
          }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    409: {
      description: "Duplicate detected (omit `?force` or pass `?merge=true` to handle)",
      content: errorContent,
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/flights/{id}",
  summary: "Update a flight",
  description:
    "Replaces the editable fields of an existing flight. Server-managed " +
    "fields (id, userId, createdAt, enrichmentHistory) are never accepted.",
  tags: ["Flights"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: flightUpdateInput } } },
  },
  responses: {
    200: {
      description: "Flight updated",
      content: { "application/json": { schema: flightResponse } },
    },
    404: { description: "Not found", content: errorContent },
  },
});

registry.registerPath({
  method: "delete",
  path: "/flights/{id}",
  summary: "Delete a flight",
  tags: ["Flights"],
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: errorContent },
  },
});

/* ───────────────────────────── trips ────────────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/trips",
  summary: "List trips",
  tags: ["Trips"],
  responses: {
    200: {
      description: "Trips",
      content: { "application/json": { schema: z.array(tripResponse) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}",
  summary: "Get a trip",
  tags: ["Trips"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Trip", content: { "application/json": { schema: tripResponse } } },
    404: { description: "Not found", content: errorContent },
  },
});

/* ─────────────────────────── companions ─────────────────────────────── */

const companionResponse = registry.register(
  "Companion",
  z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      usageCount: z.number().int().describe("Flights + trips + cruises this companion is linked to"),
    })
    .openapi("Companion")
);

registry.registerPath({
  method: "get",
  path: "/companions",
  summary: "List your companions",
  description:
    "Returns the authenticated user's saved companions, most used first. " +
    "Feeds the companion picker in the flight, trip and cruise forms.",
  tags: ["Companions"],
  responses: {
    200: {
      description: "Companions",
      content: {
        "application/json": {
          schema: z.object({ companions: z.array(companionResponse) }),
        },
      },
    },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

/* ──────────────────────────── airports ──────────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/airports/search",
  summary: "Search airports",
  description:
    "Search by IATA/ICAO (exact match preferred) or by name/city (substring). " +
    "Use this to resolve coordinates before creating a flight via API.",
  tags: ["Airports"],
  request: {
    query: z.object({
      q: z.string().min(1),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: {
      description: "Matching airports",
      content: { "application/json": { schema: z.array(airportResponse) } },
    },
  },
});

/* ───────────────────────────── stats ────────────────────────────────── */

const statsResponse = registry.register(
  "StatsSummary",
  z
    .object({
      totalFlights: z.number(),
      totalDistance: z.number().describe("Total distance flown, in km"),
      totalFlightTime: z.number().describe("Total flight time, in minutes"),
      avgDistance: z.number(),
      totalCost: z.number(),
      byStatus: z.record(z.string(), z.number()),
      byAirline: z.record(z.string(), z.number()),
      byCategory: z.record(z.string(), z.number()),
    })
    .openapi("StatsSummary")
);

registry.registerPath({
  method: "get",
  path: "/stats/summary",
  summary: "Aggregate statistics",
  description:
    "Top-level totals (distance, hours, cost) plus rollups by status, " +
    "airline and category. Other /stats/* sub-routes return more " +
    "specialized breakdowns (routes, fun, business, unique, seats, " +
    "airlines, countries) — see the Stats tag for the full list.",
  tags: ["Stats"],
  responses: {
    200: {
      description: "Stats",
      content: { "application/json": { schema: statsResponse } },
    },
  },
});

const heroStatsResponse = registry.register(
  "HeroStats",
  z
    .object({
      distanceKm: z.number().describe("Total distance flown, in km"),
      flights: z.number(),
      countries: z.number(),
      airports: z.number(),
      co2Kg: z.number(),
      flightTimeMinutes: z.number().describe("Total flight time, in minutes"),
    })
    .openapi("HeroStats")
);

registry.registerPath({
  method: "get",
  path: "/stats/hero",
  summary: "Composed hero aggregate",
  description:
    "Single aggregate combining totals from /stats/summary, /stats/airports " +
    "and /stats/fun, for dashboard hero widgets. All-time only (no date-range " +
    "filtering yet).",
  tags: ["Stats"],
  responses: {
    200: {
      description: "Hero stats",
      content: { "application/json": { schema: heroStatsResponse } },
    },
  },
});

/* ──────────────────────── parser endpoints ─────────────────────────── */

const parsedFlightSchema = registry.register(
  "ParsedFlight",
  z
    .object({
      airline: z.string().nullable(),
      flightNumber: z.string().nullable(),
      depIata: z.string().nullable(),
      arrIata: z.string().nullable(),
      departureTime: z.string().nullable(),
      arrivalTime: z.string().nullable(),
      seatNumber: z.string().nullable().optional(),
      bookingReference: z.string().nullable().optional(),
      passengerName: z.string().nullable().optional(),
    })
    .openapi("ParsedFlight")
);

registry.registerPath({
  method: "post",
  path: "/parse-email",
  summary: "Extract flights from email content",
  description:
    "Sends raw email body (text or HTML, up to 10 MB) through the LLM/regex " +
    "parser pipeline and returns one or more structured flight candidates. " +
    "Useful for AI agents that receive forwarded booking confirmations and " +
    "want to drop them into TravStats without writing per-airline regexes. " +
    "The result is NOT auto-saved — combine with `POST /flights?merge=true` " +
    "to persist with duplicate-aware enrichment.",
  tags: ["Parsers"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              emailContent: z.string().min(1).max(10 * 1024 * 1024),
              subject: z.string().max(1000).optional(),
            })
            .openapi("ParseEmailRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Parsed flights",
      content: {
        "application/json": {
          schema: z.object({
            flights: z.array(parsedFlightSchema),
            parserUsed: z.string(),
            subject: z.string().optional(),
          }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    429: { description: "Rate-limited (parser is expensive)", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/parse-boardingpass",
  summary: "Extract a flight from a boarding-pass image",
  description:
    "Accepts a base64-encoded boarding-pass image (PNG/JPEG/PDF, up to 20 MB). " +
    "Tries QR/PDF417 barcode decoding first, then OCR + vision LLM as fallback. " +
    "Like /parse-email, the result is NOT auto-saved.",
  tags: ["Parsers"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              imageBase64: z.string().min(1).max(20 * 1024 * 1024),
              enrichWithApi: z.boolean().default(true).optional(),
            })
            .openapi("ParseBoardingpassRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Parsed flight",
      content: {
        "application/json": {
          schema: z.object({
            flight: parsedFlightSchema,
            provider: z.string(),
            fallbackUsed: z.boolean().optional(),
            enriched: z.boolean().optional(),
          }),
        },
      },
    },
    400: { description: "Validation failed or invalid image", content: errorContent },
    429: { description: "Rate-limited", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/flights/batch",
  summary: "Create multiple flights atomically",
  description:
    "Insert up to 20 flights in a single transaction. Shared booking " +
    "references are auto-grouped into a Trip + Booking row, so a forwarded " +
    "round-trip confirmation lands as one trip with two flights. Each entry " +
    "uses the same shape as `POST /flights`. Errors abort the whole batch — " +
    "no partial inserts.",
  tags: ["Flights"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.array(flightCreateInput).min(1).max(20),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Flights created",
      content: {
        "application/json": {
          schema: z.object({
            flights: z.array(flightResponse),
            tripIds: z.array(z.string().uuid()).optional(),
          }),
        },
      },
    },
    400: { description: "Batch too large or any entry invalid", content: errorContent },
    429: { description: "Rate-limited (batch is heavy)", content: errorContent },
  },
});

/* ─────────────────────────── api tokens ─────────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/settings/tokens",
  summary: "List your API tokens",
  description: "Cookie-authenticated only. PAT-authenticated requests are rejected with 403.",
  tags: ["API Tokens"],
  responses: {
    200: {
      description: "Tokens",
      content: {
        "application/json": {
          schema: z.object({ tokens: z.array(sanitizedApiTokenSchema) }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/settings/tokens",
  summary: "Create a new API token",
  description:
    "The plaintext token is returned exactly once in the `plaintext` field — " +
    "it cannot be retrieved later. Cookie-authenticated only.",
  tags: ["API Tokens"],
  request: {
    body: { content: { "application/json": { schema: createApiTokenSchema } } },
  },
  responses: {
    201: {
      description: "Token created",
      content: { "application/json": { schema: createdApiTokenSchema } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/settings/tokens/{id}",
  summary: "Revoke an API token",
  tags: ["API Tokens"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Revoked",
      content: { "application/json": { schema: sanitizedApiTokenSchema } },
    },
  },
});

/* ─────────────────────────── diagnostics ────────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/diagnostics",
  summary: "User-scoped data snapshot for bug reports",
  description:
    "Returns a redacted JSON snapshot of selected flights and trips so the " +
    "reporter can paste a reproducible state into a GitHub issue. Distinct " +
    "from `/diagnostic-export`, which returns server log tails. All filters " +
    "are optional and combined with AND. Sensitive fields (bookingReference, " +
    "ticketNumber, frequentFlyerNumber, price/taxes/fees, currency, " +
    "receiptUrl, coPassengers, companions, userId, notes) are replaced with " +
    "`null`; the response's `redacted` array advertises the exact list. " +
    "`recentErrors` is reserved for v1.5.x and currently always `[]`. " +
    "`read` scope is sufficient.",
  tags: ["Diagnostics"],
  request: {
    query: z.object({
      flightIds: z.string().optional().openapi({
        description: "Comma-separated UUIDs",
        example: "uuid1,uuid2",
      }),
      tripIds: z.string().optional().openapi({
        description: "Comma-separated UUIDs",
        example: "uuid1,uuid2",
      }),
      airline: z.string().optional().openapi({
        description: "Convenience filter equivalent to /flights?airline=…",
        example: "Iberia",
      }),
      since: z.string().datetime().optional().openapi({
        description: "ISO 8601 datetime — only flights/trips with updatedAt >= since",
        example: "2026-05-09T15:00:00Z",
      }),
    }),
  },
  responses: {
    200: {
      description: "Diagnostics bundle",
      content: {
        "application/json": {
          schema: z.object({
            generatedAt: z.string(),
            travstatsVersion: z.string(),
            schemaVersion: z.string(),
            redacted: z.array(z.string()),
            flights: z.array(z.record(z.unknown())),
            trips: z.array(z.record(z.unknown())),
            recentErrors: z.array(z.unknown()),
            filters: z.record(z.unknown()),
            counts: z.object({
              flights: z.number().int(),
              trips: z.number().int(),
            }),
          }),
        },
      },
    },
    401: { description: "Unauthenticated", content: errorContent },
    429: { description: "Rate-limited", content: errorContent },
  },
});
