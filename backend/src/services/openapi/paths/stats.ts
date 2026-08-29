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

/**
 * The specialised breakdowns.
 *
 * These are read-only aggregates over what the user already has. Two things
 * hold across all of them and are stated once here rather than repeated:
 *
 * TIMES ARE READ AT THE AIRPORT. Every "when did I fly" figure — the
 * time-of-day buckets, the busiest month, the year rollups — uses the clock at
 * the departure airport, not the stored instant and not the viewer's zone. A
 * flight leaving Bangkok late in the evening belongs to that evening, whatever
 * UTC says about it.
 *
 * A DATE-ONLY FLIGHT REPORTS NO HOUR. Historical rows carry a date without a
 * time; they are counted in everything daily and above, and excluded from
 * anything hourly rather than being counted at their 12:00 placeholder.
 */
const statsTag = ["Stats"];

function readOnlyStat(path: string, summary: string, description?: string): void {
  registry.registerPath({
    method: "get",
    path,
    summary,
    ...(description ? { description } : {}),
    tags: statsTag,
    responses: { 200: { description: summary } },
  });
}

readOnlyStat("/stats/timeseries", "Flights and distance over time", "Grouped by the departure airport's calendar day.");
readOnlyStat("/stats/routes", "Most-flown routes");
readOnlyStat("/stats/airlines", "Airlines, by flights and distance");
readOnlyStat("/stats/airports", "Airports, by visits and by role as origin or destination");
readOnlyStat("/stats/countries", "Countries reached", "Counted by country CODE, not by the spelling a geocoder returned — the same country arriving as \"Egypt\" and as its own-language name is one country here.");
readOnlyStat("/stats/aircraft", "Individual aircraft flown, by registration");
readOnlyStat("/stats/aircraft-types", "Aircraft types flown");
readOnlyStat("/stats/seats", "Seats and cabin classes");
readOnlyStat("/stats/punctuality", "Delays, where actual times are known", "Only flights carrying an actual departure or arrival contribute; a flight with scheduled times alone is not counted as on time.");
readOnlyStat("/stats/business", "Business travel");
readOnlyStat("/stats/fun", "The playful figures", "Time-of-day buckets, weekend warrior, fastest day, most countries in one day and the rest. All of them read the clock at the airport.");
readOnlyStat("/stats/unique", "Firsts and unique counts");
readOnlyStat("/stats/travel-account", "Everything, across all domains", "The cross-domain rollup the overview tab draws: flights, cruises, lodging and places in one answer.");
readOnlyStat("/stats/cruise", "Cruise statistics", "Distance comes from the computed sea legs; a cruise the router never ran for contributes 0 rather than a straight-line guess.");
readOnlyStat("/stats/lodging", "Lodging statistics", "A stay counts as nights only after its check-out, so a stay in progress is not yet in the totals.");

registry.registerPath({
  method: "get",
  path: "/stats/aircraft/{registration}",
  summary: "One aircraft's history",
  description: "Every flight recorded on that airframe, by its registration.",
  tags: statsTag,
  request: { params: z.object({ registration: z.string() }) },
  responses: {
    200: { description: "Aircraft history" },
    404: { description: "No flights on that registration" },
  },
});
