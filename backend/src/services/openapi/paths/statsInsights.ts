/**
 * GET /stats/insights/* — the statistics expansion (forgejo#258, #259, #260,
 * #264). Its own module because `./stats.ts` is close to the 800-line limit.
 */

import { registry } from "../registry";
import { errorContent } from "./shared";
import { lodgingInsightsResponseSchema } from "../../../schemas/statsInsights/lodging";
import { placeInsightsResponseSchema } from "../../../schemas/statsInsights/places";

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
