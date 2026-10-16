import { z } from "zod";
import { registry } from "../registry";

const styleUrl = z.string().url().openapi({ description: "Public HTTPS MapLibre style URL" });
const mapConfigSchema = z
  .object({
    version: z.literal(1),
    styles: z.object({
      standard: styleUrl,
      light: styleUrl,
      dark: styleUrl,
      voyager: styleUrl.openapi({
        description: "Historical style id; shows the Bright style (OpenFreeMap) by default",
      }),
    }),
  })
  .openapi("MapConfig");

registry.registerPath({
  method: "get",
  path: "/map-config",
  tags: ["Maps"],
  security: [],
  summary: "Public map style configuration",
  description: "Version 1 public style URLs for clients. No credentials or user data.",
  responses: {
    200: {
      description: "Map style configuration",
      content: { "application/json": { schema: mapConfigSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/map-config/runtime",
  tags: ["Maps"],
  security: [],
  summary: "Browser map configuration bootstrap",
  description:
    "JavaScript assigning the same configuration to window.__TRAVSTATS_MAP_CONFIG__ before the web app starts.",
  responses: {
    200: {
      description: "Map configuration bootstrap",
      content: { "application/javascript": { schema: z.string() } },
    },
  },
});
