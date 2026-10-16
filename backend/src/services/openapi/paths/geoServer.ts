import { z } from "zod";
import { registry } from "../registry";

registry.registerPath({
  method: "get",
  path: "/geo-server/runtime",
  tags: ["Maps"],
  security: [],
  summary: "Read the public map-provider bootstrap",
  description:
    "JavaScript setting the instance's own/legacy map mode. Never exposes the provider origin or credentials.",
  responses: {
    200: {
      description: "Map bootstrap",
      content: { "application/javascript": { schema: z.string() } },
    },
    503: { description: "Invalid or unavailable configuration; bootstrap stays pending" },
  },
});

registry.registerPath({
  method: "get",
  path: "/geo-server/assets/*",
  tags: ["Maps"],
  security: [],
  summary: "Read an allowlisted public basemap resource",
  description:
    "The wildcard is a bounded style, tile, sprite or font path. Query parameters and arbitrary provider URLs are rejected. No user location or routing data is served.",
  responses: {
    200: {
      description:
        "Style JSON, vector tile, font or PNG; resource URLs are rewritten to this origin",
      content: {
        "application/json": { schema: z.record(z.string(), z.unknown()) },
        "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) },
        "application/x-protobuf": { schema: z.string().openapi({ format: "binary" }) },
        "application/vnd.mapbox-vector-tile": { schema: z.string().openapi({ format: "binary" }) },
        "image/png": { schema: z.string().openapi({ format: "binary" }) },
      },
    },
    404: { description: "Disabled provider, unsupported resource or query parameters" },
    429: { description: "Rate limit exceeded" },
    502: { description: "Invalid upstream response" },
    503: { description: "Provider unavailable" },
    default: { description: "Non-success status returned by the configured provider" },
  },
});
