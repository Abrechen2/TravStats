/**
 * Reference catalogues: ports, ships, airlines, aircraft types — plus the
 * geocoding and type-ahead helpers that sit on top of them.
 *
 * These are shared, instance-wide tables rather than per-user data. A POST
 * adds a user-contributed row (`isUserAdded`), which re-seeding never
 * overwrites; a read-scoped token is rejected on every POST here.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const listEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ success: z.literal(true), data: z.array(data), total: z.number().int() });

const port = registry.register(
  "Port",
  z
    .object({
      id: z.number().int(),
      name: z.string(),
      city: z.string().nullable(),
      country: z.string().nullable(),
      unlocode: z.string().nullable(),
      lat: z.number(),
      lon: z.number(),
      timezone: z.string().nullable(),
      region: z.string().nullable(),
      isUserAdded: z.boolean(),
    })
    .openapi("Port")
);

const ship = registry.register(
  "Ship",
  z
    .object({
      id: z.number().int(),
      name: z.string(),
      imo: z.string().nullable(),
      cruiseLine: z.string(),
      yearBuilt: z.number().int().nullable(),
      grossTonnage: z.number().int().nullable(),
      capacity: z.number().int().nullable(),
      isUserAdded: z.boolean(),
    })
    .openapi("Ship")
);

const airline = registry.register(
  "Airline",
  z
    .object({
      id: z.number().int(),
      iata: z.string().nullable(),
      icao: z.string().nullable(),
      name: z.string(),
      callsign: z.string().nullable(),
      country: z.string().nullable(),
    })
    .openapi("Airline")
);

const aircraftType = registry.register(
  "AircraftType",
  z
    .object({
      id: z.number().int(),
      icao: z.string().nullable(),
      name: z.string(),
    })
    .openapi("AircraftType")
);

/* ───────────────────────────────── ports ────────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/ports",
  summary: "Search the port catalogue",
  tags: ["Catalogue"],
  request: {
    query: z.object({
      q: z.string().max(100).optional().describe("Free-text match on name, city and UN/LOCODE"),
      region: z.string().max(40).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().describe("Default 100"),
    }),
  },
  responses: {
    200: { description: "Ports", content: { "application/json": { schema: listEnvelope(port) } } },
    400: { description: "Validation failed", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/ports/geocode",
  summary: "Resolve a port name to catalogue entries",
  description:
    "Name-first lookup used by the cruise import to turn an unresolved stop into " +
    "a matched port. Returns an empty list rather than 404 when nothing matches.",
  tags: ["Catalogue"],
  request: { query: z.object({ q: z.string().max(200) }) },
  responses: {
    200: { description: "Candidate ports", content: { "application/json": { schema: envelope(z.array(port)) } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/ports",
  summary: "Add a port to the catalogue",
  description: "Stored with `isUserAdded: true`, which protects it from being overwritten by a re-seed.",
  tags: ["Catalogue"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1).max(120),
            city: z.string().max(120).optional(),
            country: z.string().max(120).optional(),
            unlocode: z.string().max(10).optional(),
            lat: z.number().min(-90).max(90),
            lon: z.number().min(-180).max(180),
            timezone: z.string().max(60).optional(),
            region: z.string().max(40).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: envelope(port) } } },
    400: { description: "Validation failed", content: errorContent },
    403: { description: "Read-scoped token", content: errorContent },
  },
});

/* ───────────────────────────────── ships ────────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/ships",
  summary: "Search the ship catalogue",
  tags: ["Catalogue"],
  request: {
    query: z.object({
      q: z.string().max(100).optional(),
      cruiseLine: z.string().max(120).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().describe("Default 100"),
    }),
  },
  responses: {
    200: { description: "Ships", content: { "application/json": { schema: listEnvelope(ship) } } },
    400: { description: "Validation failed", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/ships",
  summary: "Add a ship to the catalogue",
  description: "Rows whose IMO already exists are skipped by re-seeding, so a user-added ship survives updates.",
  tags: ["Catalogue"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1).max(120),
            imo: z.string().max(10).optional(),
            cruiseLine: z.string().min(1).max(120),
            yearBuilt: z.number().int().min(1800).max(2100).optional(),
            grossTonnage: z.number().int().min(0).optional(),
            capacity: z.number().int().min(0).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: envelope(ship) } } },
    400: { description: "Validation failed", content: errorContent },
    403: { description: "Read-scoped token", content: errorContent },
  },
});

/* ──────────────────────────────── airlines ──────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/airlines",
  summary: "Search the airline catalogue",
  tags: ["Catalogue"],
  request: {
    query: z.object({
      q: z.string().max(100).optional().describe("Matches name, or an exact IATA/ICAO code"),
      limit: z.coerce.number().int().min(1).max(100).optional().describe("Default 50"),
    }),
  },
  responses: {
    200: { description: "Airlines", content: { "application/json": { schema: listEnvelope(airline) } } },
    400: { description: "Validation failed", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/airlines",
  summary: "Add an airline to the catalogue",
  tags: ["Catalogue"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            iata: z.string().min(2).max(3).optional(),
            icao: z.string().min(3).max(4).optional(),
            name: z.string().min(1).max(120),
            callsign: z.string().max(120).optional(),
            country: z.string().max(120).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: envelope(airline) } } },
    400: { description: "Validation failed", content: errorContent },
    403: { description: "Read-scoped token", content: errorContent },
  },
});

/* ──────────────────────────────── aircraft ──────────────────────────── */

registry.registerPath({
  method: "get",
  path: "/aircraft",
  summary: "Search the aircraft-type catalogue",
  tags: ["Catalogue"],
  request: {
    query: z.object({
      q: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().describe("Default 50"),
    }),
  },
  responses: {
    200: { description: "Aircraft types", content: { "application/json": { schema: listEnvelope(aircraftType) } } },
    400: { description: "Validation failed", content: errorContent },
  },
});

registry.registerPath({
  method: "post",
  path: "/aircraft",
  summary: "Add an aircraft type to the catalogue",
  tags: ["Catalogue"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            icao: z.string().min(3).max(4).optional(),
            name: z.string().min(1).max(120),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: envelope(aircraftType) } } },
    400: { description: "Validation failed", content: errorContent },
    403: { description: "Read-scoped token", content: errorContent },
  },
});

/* ─────────────────────────────── suggestions ────────────────────────── */

const suggestionList = z.object({
  suggestions: z.array(z.object({ value: z.string(), count: z.number().int() })),
});

registry.registerPath({
  method: "get",
  path: "/suggestions/airlines",
  summary: "Type-ahead for airlines you have flown",
  description: "Drawn from your own flights, most used first — unlike /airlines, which searches the global catalogue.",
  tags: ["Catalogue"],
  request: { query: z.object({ q: z.string().max(100).optional() }) },
  responses: {
    200: { description: "Suggestions", content: { "application/json": { schema: suggestionList } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/suggestions/aircraft",
  summary: "Type-ahead for aircraft you have flown",
  tags: ["Catalogue"],
  request: { query: z.object({ q: z.string().max(100).optional() }) },
  responses: {
    200: { description: "Suggestions", content: { "application/json": { schema: suggestionList } } },
  },
});

/* ────────────────────────────────── geo ─────────────────────────────── */

const geoResult = z.object({
  name: z.string(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
});

const degradedEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
    degraded: z
      .boolean()
      .describe("True when the upstream geocoder was unavailable and the result set is incomplete rather than empty"),
  });

registry.registerPath({
  method: "get",
  path: "/geo/search",
  summary: "Search-as-you-type geocoding",
  description:
    "Backed by Photon, not Nominatim — Nominatim's usage policy forbids " +
    "per-keystroke queries. Never throws on an upstream failure; it answers " +
    "200 with `degraded: true` so a form keeps working without a geocoder.",
  tags: ["Geo"],
  request: {
    query: z.object({
      q: z.string().min(2).max(200),
      lang: z.string().length(2).optional(),
    }),
  },
  responses: {
    200: { description: "Matches", content: { "application/json": { schema: degradedEnvelope(z.array(geoResult)) } } },
    400: { description: "Validation failed", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/geo/reverse",
  summary: "Coordinates to address parts",
  description: "One-shot lookups via Nominatim, which carries its own 1 req/s throttle and cache.",
  tags: ["Geo"],
  request: {
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lon: z.coerce.number().min(-180).max(180),
    }),
  },
  responses: {
    200: {
      description: "Address parts",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              street: z.string().nullable(),
              houseNumber: z.string().nullable(),
              postalCode: z.string().nullable(),
              city: z.string().nullable(),
              country: z.string().nullable(),
            }),
          }),
        },
      },
    },
    400: { description: "Validation failed", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/geo/reverse-places",
  summary: "Nearby places for a picked pin",
  description: "Returns up to five nearby points of interest, for the map-pick modal's POI list.",
  tags: ["Geo"],
  request: {
    query: z.object({
      lat: z.coerce.number().min(-90).max(90),
      lon: z.coerce.number().min(-180).max(180),
      lang: z.string().length(2).optional(),
    }),
  },
  responses: {
    200: { description: "Nearby places", content: { "application/json": { schema: degradedEnvelope(z.array(geoResult)) } } },
    400: { description: "Validation failed", content: errorContent },
    429: { description: "Rate limited", content: errorContent },
  },
});
