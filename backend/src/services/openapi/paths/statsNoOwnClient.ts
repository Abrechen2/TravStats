/**
 * The stats routes the web app does not call itself (forgejo#407, owner
 * decision 2026-10-29): `/stats/business` and `/stats/unique` live here, and
 * `stats.ts` — close to the 800-line limit — takes the shared note from this
 * module for `/stats/fun` and `/stats/seats`. The web reads the same figures
 * through `/stats/page`; the routes stay as public API for other clients.
 */

import { businessStatsSchema, uniqueStatsSchema } from "../../../schemas/statsFlights";
import { registry } from "../registry";

export const NO_OWN_CLIENT_NOTE =
  "No own client: the web app reads these same figures through `/stats/page`; this route is kept as public API for other clients.";

const statsTag = ["Stats"];

const businessStats = registry.register(
  "BusinessStats",
  businessStatsSchema.openapi("BusinessStats")
);
const uniqueStats = registry.register("UniqueStats", uniqueStatsSchema.openapi("UniqueStats"));

registry.registerPath({
  method: "get",
  path: "/stats/business",
  summary: "Business travel",
  description: NO_OWN_CLIENT_NOTE,
  tags: statsTag,
  responses: {
    200: {
      description: "Cost and category aggregates",
      content: { "application/json": { schema: businessStats } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/stats/unique",
  summary: "Firsts and unique counts",
  description: NO_OWN_CLIENT_NOTE,
  tags: statsTag,
  responses: {
    200: {
      description: "The one-off figures",
      content: { "application/json": { schema: uniqueStats } },
    },
  },
});
