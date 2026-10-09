/**
 * The stats insights, beside the frozen `./stats.ts` (close to the 800-line
 * limit): flights and cruises at /stats/flight-insights and
 * /stats/cruise-insights (forgejo#256, #257), lodging, places, roadtrips and
 * tours under /stats/insights/* (forgejo#258, #259, #260, #264).
 */

import { registry } from "../registry";
import { errorContent } from "./shared";
import { flightInsightsSchema } from "../../../schemas/statsFlightInsights";
import { cruiseInsightsSchema } from "../../../schemas/statsCruiseInsights";
import { WrappedQuerySchema } from "../../../schemas/statsQuery";
import { lodgingInsightsResponseSchema } from "../../../schemas/statsInsights/lodging";
import { placeInsightsResponseSchema } from "../../../schemas/statsInsights/places";
import { roadtripInsightsResponseSchema } from "../../../schemas/statsInsights/roadtrips";
import { tourInsightsResponseSchema } from "../../../schemas/statsInsights/tours";

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

const STANDARD_ERRORS = {
  304: { description: "Not modified since the ETag in If-None-Match" },
  401: { description: "Missing or invalid token", content: errorContent },
} as const;

const lodgingInsights = registry.register(
  "LodgingInsights",
  lodgingInsightsResponseSchema.openapi("LodgingInsights")
);

registry.registerPath({
  method: "get",
  path: "/stats/insights/lodging",
  summary: "Lodging insights: sleeping style, returns, bases, prices, week rhythm",
  description:
    "Lifetime, with per-year series. Counts only stays whose check-out is past; " +
    "nights fall on the hotel-local date they start; prices are compared within one " +
    "currency and one room/board, never converted; a business night needs a trip " +
    "explicitly marked business.",
  tags: ["Stats"],
  responses: {
    200: {
      description: "The insights",
      content: { "application/json": { schema: lodgingInsights } },
    },
    ...STANDARD_ERRORS,
  },
});

const placeInsights = registry.register(
  "PlaceInsights",
  placeInsightsResponseSchema.openapi("PlaceInsights")
);

registry.registerPath({
  method: "get",
  path: "/stats/insights/places",
  summary: "Places insights: discoveries, returns, variety, documentation, largest jump",
  description:
    "Lifetime, with per-year series on the place's own calendar. A first visit is a " +
    "discovery only when no undated visit of the same place could be earlier; the largest " +
    "jump is a straight line between two visits whose order is certain, never a distance " +
    "travelled. Photo, note and rating are counted independently.",
  tags: ["Stats"],
  responses: {
    200: {
      description: "The insights",
      content: { "application/json": { schema: placeInsights } },
    },
    ...STANDARD_ERRORS,
  },
});

const roadtripInsights = registry.register(
  "RoadtripInsights",
  roadtripInsightsResponseSchema.openapi("RoadtripInsights")
);

registry.registerPath({
  method: "get",
  path: "/stats/insights/roadtrips",
  summary: "Roadtrip insights: recorded against planned, day stages, road and ferry, nights, tours",
  description:
    "Each stretch between two stations is placed on its own calendar: before today it is " +
    "recorded, today it is current, after today planned. Ferry km are never driven km; a " +
    "linked stay's night is counted once; day tours from a station are reported beside the " +
    "driving, never added to it.",
  tags: ["Stats"],
  responses: {
    200: {
      description: "The insights",
      content: { "application/json": { schema: roadtripInsights } },
    },
    ...STANDARD_ERRORS,
  },
});

const tourInsights = registry.register(
  "TourInsights",
  tourInsightsResponseSchema.openapi("TourInsights")
);

registry.registerPath({
  method: "get",
  path: "/stats/insights/tours",
  summary: "Day-tour insights: per activity, moving and pause time, records, rhythm, links",
  description:
    "Per activity (hike, bike, guided excursion …): completed tours with distance, climb " +
    "and time, each with how many tours it rests on. Moving time and pauses come only from " +
    "recordings. A guided excursion is a tour, never a bus ride or driven kilometres.",
  tags: ["Stats"],
  responses: {
    200: {
      description: "The insights",
      content: { "application/json": { schema: tourInsights } },
    },
    ...STANDARD_ERRORS,
  },
});
