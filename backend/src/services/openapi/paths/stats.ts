/**
 * Statistics endpoints.
 */

import { z } from "zod";

import { registry } from "../registry";

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

const networkResponse = registry.register(
  "FlightNetwork",
  z
    .object({
      airports: z.array(
        z.object({
          iata: z
            .string()
            .describe(
              "IATA where the catalogue knows one, otherwise the code the " +
                "flight row carried. Routes refer to airports by this code."
            ),
          lat: z.number(),
          lon: z.number(),
          visits: z.number().describe("Flights departing from or landing at this airport"),
        })
      ),
      routes: z.array(
        z.object({
          aIata: z.string().describe("The alphabetically smaller code of the pair"),
          bIata: z.string(),
          count: z.number().describe("Flights on the pair, both directions together"),
          distanceKm: z.number(),
        })
      ),
    })
    .openapi("FlightNetwork")
);

registry.registerPath({
  method: "get",
  path: "/stats/network",
  summary: "The whole flight network",
  description:
    "Every airport that can be plotted plus every airport PAIR that has been " +
    "flown — the input for a route map or globe. A route is undirected: " +
    "FRA-WAW and WAW-FRA are one entry with a count of two, matching how " +
    "/stats/routes groups. Deliberately unbounded and un-paginated: a " +
    "truncated network draws a wrong map, not a smaller one. Airports " +
    "without usable coordinates are omitted, as are routes touching them.",
  tags: ["Stats"],
  responses: {
    200: {
      description: "Flight network",
      content: { "application/json": { schema: networkResponse } },
    },
  },
});

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
