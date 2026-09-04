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
      totalCost: z
        .number()
        .nullable()
        .describe("Null when no flight in the window carries a price — never 0 for an unpriced year"),
      unpricedFlights: z.number(),
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
readOnlyStat(
  "/stats/passport",
  "The passport: countries, their airports, and a continent quota",
  "Derived server-side so several clients draw the same picture. A country counts " +
    "if a flight began OR ended there, matching how countries are counted elsewhere; " +
    "booked flights are excluded; each airport is stamped once, dated its first " +
    "visit. Dates go out as dates, never as month names: the month belongs to the " +
    "reader's language. `continentsVisited` counts real continents, while `groups` " +
    "says how the rows are drawn — Africa and Antarctica share a row but are two " +
    "continents, so reaching Antarctica moves the number. The per-continent " +
    "denominator is the countries THIS catalogue knows, deliberately not one of the " +
    "several competing counts of the world's countries, none of which is a fact. " +
    "Each country also carries `daysPresent` — the distinct calendar days a record " +
    "ATTESTS, which is not the same as the days it spans. A house or a port call " +
    "attests its whole range, because the record says so; a pair of flights attests " +
    "only the arrival day and the departure day, never the gap between them. The " +
    "gap is the absence of a recorded departure, not evidence of presence, and " +
    "reading it as presence once reported 2200 days in a traveller's home country. " +
    "Alongside it `groundTime` has THREE states: `measured` with raw minutes " +
    "(never bucketed) where a flight pair bounds a spell of at most one night, " +
    "`unknown` where a flight touched the country but nothing bounds a believable " +
    "spell — a one-way arrival, a row with no usable clock, or a gap spanning more " +
    "nights than a stay could — and `notApplicable` where no flight touched it at " +
    "all. A country proved only by a hotel has an unknown ground time, not a zero " +
    "one, and is never given a synthesised number. Since 2026-09-02 a country may " +
    "also be proved by `track` — location history reduced to country-days on the " +
    "server, never positions — which is the only evidence that can raise a country " +
    "no flight, cruise or house records, such as one crossed by car. It brings the " +
    "`transited` tier with it: a day shared with another country is a border " +
    "crossed on the ground, which counts, while a country whose every recorded " +
    "point lay at an airport the traveller demonstrably flew through stays a " +
    "`connection`, which does not. A track proves DAYS and never hours: it bounds " +
    "no departure, so its ground time is `notApplicable`."
);

readOnlyStat(
  "/stats/records",
  "The seven travel records",
  "Longest and shortest flight, busiest day, longest aloft, biggest delay, " +
    "northernmost airport and longest streak. Numbers, not sentences: each record " +
    "carries a value, a unit and the raw parts of its detail, because a formatted " +
    '"12.345 km" would fix the decimal separator and the unit for every client. A ' +
    "record that cannot be derived is OMITTED rather than zeroed — a shortest " +
    "flight of 0 km would win forever, and a missing delay means \"not recorded\", " +
    "which is a different fact from \"on time\"."
);

registry.registerPath({
  method: "get",
  path: "/stats/countries/{code}",
  summary: "One country, in detail",
  description:
    "The drill-down behind a passport row: the airports used there, the years, " +
    "and a timeline of what happened. Accepts an ISO alpha-2 code or an English " +
    "country name. It answers for a country reached only by cruise or by a " +
    "recorded place too — the passport lists those rows, so refusing them here " +
    "would put the list and the page into disagreement; such a country carries no " +
    "entries and no airports and says so through `evidence`. A country proved " +
    "only by a LODGING answers here too, and its timeline names the house with " +
    "its id, so the record behind a country is one click from the row and " +
    "editable — the point of the drill-down, not a detail of it. No country name " +
    "and no composed prose: the client names the code in the reader's language. " +
    "The tier, the days present and the ground time are NOT here: they belong to " +
    "the passport row, where one derivation owns them. A country proved by " +
    "location history answers here too, as a single `track` timeline entry " +
    "carrying the number of days and the number of recorded points — a count, " +
    "never a verdict: the upstream payload cannot say whether a point was " +
    "measured by GPS or estimated from a photograph, so nothing here claims to.",
  tags: statsTag,
  request: { params: z.object({ code: z.string() }) },
  responses: {
    200: { description: "Country detail" },
    404: { description: "Nothing evidences that country" },
  },
});

registry.registerPath({
  method: "get",
  path: "/stats/wrapped",
  summary: "The year in review",
  description:
    "Without `year`, the story is about the latest year that has anything in it — " +
    "read off the data and never off the wall clock, so the same account tells the " +
    "same story on New Year's Eve and the morning after. `availableYears` lists " +
    "what can be asked for. `rank` is exact: 'second' only when exactly one year " +
    "had more flights, 'top' only when none did. A favourite the year cannot " +
    "support is null rather than zero, so the story skips that page instead of " +
    "drawing an empty one. The top route is the PAIR, not the direction, matching " +
    "/stats/routes; `newCountries` counts evidence, matching /stats/passport.",
  tags: statsTag,
  request: { query: z.object({ year: z.coerce.number().int().optional() }) },
  responses: {
    200: { description: "The year in review" },
    404: { description: "No countable activity in any year" },
  },
});

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
