/**
 * The flight and cruise insights (forgejo#256, #257). Their own module because
 * `./stats.ts` is close to the 800-line limit.
 */

import { registry } from "../registry";
import { errorContent } from "./shared";
import { flightInsightsSchema } from "../../../schemas/statsFlightInsights";
import { cruiseInsightsSchema } from "../../../schemas/statsCruiseInsights";
import { WrappedQuerySchema } from "../../../schemas/statsQuery";

const flightInsights = registry.register(
  "FlightInsights",
  flightInsightsSchema.openapi("FlightInsights")
);

registry.registerPath({
  method: "get",
  path: "/stats/flight-insights",
  summary: "Discovery, returns, network growth, transfer times and the year's story",
  description:
    "Every figure is measured over the counted flights (flown and historical) and " +
    "filed on the airport's own calendar. 'New' means first recorded in the whole " +
    "logbook, so the first recorded year discovers everything it names. A transfer is " +
    "only ever measured between two flights of ONE booking, both flown, both ends " +
    "known to the minute and their order certain — the booking page's own rule " +
    "(shared/flightTransfer.ts); every other gap is counted under its reason in " +
    "`transfers.coverage`, never as zero minutes. `?year=` picks the story's year; " +
    "without it the story is about the latest year with a counted flight.",
  tags: ["Stats"],
  request: { query: WrappedQuerySchema },
  responses: {
    200: {
      description: "The insights",
      content: { "application/json": { schema: flightInsights } },
    },
    304: { description: "Not modified since the ETag in If-None-Match" },
    400: { description: "Invalid year", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});

const cruiseInsights = registry.register(
  "CruiseInsights",
  cruiseInsightsSchema.openapi("CruiseInsights")
);

registry.registerPath({
  method: "get",
  path: "/stats/cruise-insights",
  summary: "Special events, new ports, time in port, excursions and sea-day patterns",
  description:
    "Measured over the sailed cruises. The special events are the badges' own " +
    "calculator run per cruise, so each names the voyage that proved it. A port is " +
    "new on the first cruise (by start date) it appears on in the whole logbook; an " +
    "unresolved port is counted apart, never as new. Time in port is measured only " +
    "where arrival and departure are both known to the minute — every other call is " +
    "counted under its reason and kept out of the average. A shore excursion is an " +
    "excursion note on a call, or a day tour on the call's local day starting within " +
    "`excursions.linkRuleKm` of the port; tours are left out entirely (`toursVisible: " +
    "false`) while the reader does not see them. A cruise with nothing documented has " +
    "no documented excursion — not zero. `?year=` cuts the per-cruise lists to the " +
    "cruises that started that year.",
  tags: ["Stats"],
  request: { query: WrappedQuerySchema },
  responses: {
    200: {
      description: "The insights",
      content: { "application/json": { schema: cruiseInsights } },
    },
    304: { description: "Not modified since the ETag in If-None-Match" },
    400: { description: "Invalid year", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
  },
});
