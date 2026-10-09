/**
 * The flight and cruise insights (forgejo#256, #257). Their own module because
 * `./stats.ts` is close to the 800-line limit.
 */

import { registry } from "../registry";
import { errorContent } from "./shared";
import { flightInsightsSchema } from "../../../schemas/statsFlightInsights";
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
