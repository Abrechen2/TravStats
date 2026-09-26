/**
 * GET /stats/network/route/{a}/{b} — one arc of the globe (forgejo#132 item 9).
 * Its own module because `./stats.ts` is close to the 800-line limit.
 */

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  networkRouteDetailSchema,
  networkRouteParamsSchema,
  networkRouteQuerySchema,
} from "../../../schemas/statsNetworkRoute";

const networkRouteDetail = registry.register(
  "FlightNetworkRoute",
  networkRouteDetailSchema.openapi("FlightNetworkRoute")
);

registry.registerPath({
  method: "get",
  path: "/stats/network/route/{a}/{b}",
  summary: "One route of the flight network, in detail",
  description:
    "The facts behind one arc of /stats/network: its flights (paged, newest " +
    "first), the distinct airlines that flew it, the average duration and the " +
    "last year flown. The pair is unordered — /route/FRA/WAW and /route/WAW/FRA " +
    "answer the same route — and a flight belongs to it by the same pairing " +
    "rule the network counts with, so `count` is the arc's number. Kept off " +
    "/stats/network itself so that unbounded payload does not grow with the " +
    "whole flight history; this one is bounded by the page size.",
  tags: ["Stats"],
  request: { params: networkRouteParamsSchema, query: networkRouteQuerySchema },
  responses: {
    200: {
      description: "The route",
      content: { "application/json": { schema: networkRouteDetail } },
    },
    304: { description: "Not modified since the ETag in If-None-Match" },
    400: { description: "Invalid airport code or paging", content: errorContent },
    401: { description: "Missing or invalid token", content: errorContent },
    404: { description: "No counted flight on this pair", content: errorContent },
  },
});
