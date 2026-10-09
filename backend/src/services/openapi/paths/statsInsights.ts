/**
 * GET /stats/insights/* — the statistics expansion (forgejo#258, #259, #260,
 * #264). Its own module because `./stats.ts` is close to the 800-line limit.
 */

import { registry } from "../registry";
import { errorContent } from "./shared";
import { lodgingInsightsResponseSchema } from "../../../schemas/statsInsights/lodging";
import { placeInsightsResponseSchema } from "../../../schemas/statsInsights/places";
import { roadtripInsightsResponseSchema } from "../../../schemas/statsInsights/roadtrips";
import { tourInsightsResponseSchema } from "../../../schemas/statsInsights/tours";

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
