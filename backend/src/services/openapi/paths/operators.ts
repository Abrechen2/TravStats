/**
 * Operator marks for the map cards (forgejo#323): a rail operator's, coach
 * company's, ferry line's, cruise line's or rental company's logo, by the name
 * a journey records. From the vendored catalogues, else from Wikidata and
 * Wikimedia Commons — server side, free licences only, credited.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const query = z.object({
  domain: z.enum(["rail", "bus", "ferry", "rental", "cruise"]),
  name: z.string().min(1).max(120),
});

const credit = registry.register(
  "OperatorMarkCredit",
  z
    .object({
      qid: z.string().describe("The Wikidata item the logo was read from"),
      file: z.string().describe("The Commons file name"),
      licence: z.string().describe("Licence as Commons names it, e.g. 'Public domain'"),
      licenceUrl: z.string().nullable(),
      artist: z.string().nullable().describe("The author, plain text, when stated"),
      sourceUrl: z.string().describe("The file's page on Commons"),
      colour: z.string().nullable().describe("The operator's official colour (P465), #rrggbb"),
    })
    .openapi("OperatorMarkCredit")
);

const mark = registry.register(
  "OperatorMark",
  z
    .object({
      available: z.boolean(),
      source: z.enum(["catalogue", "wikidata"]).nullable(),
      credit: credit.nullable().describe("Null for a catalogue logo (the company's own icon)"),
    })
    .openapi("OperatorMark")
);

registry.registerPath({
  method: "get",
  path: "/operators/mark",
  tags: ["Operators"],
  summary: "Whether an operator has a logo, and whom to credit for it",
  description:
    "Catalogued rail operators and rental companies first, then Wikidata (only while the " +
    "admin switch `operatorLogosOpenDataEnabled` is on). Never a stand-in: `available: false` " +
    "means the client draws a monogram.",
  request: { query },
  responses: {
    200: {
      description: "The mark",
      content: {
        "application/json": { schema: z.object({ success: z.literal(true), data: mark }) },
      },
    },
    400: { description: "No domain or name", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/operators/logo",
  tags: ["Operators"],
  summary: "An operator's logo bytes",
  description:
    "Always a raster image — Commons renders an SVG logo to PNG — served with " +
    "`Cache-Control: private`. 404 when there is no logo; the client draws a monogram then.",
  request: { query },
  responses: {
    200: {
      description: "Raster logo",
      content: { "image/png": { schema: z.string().openapi({ format: "binary" }) } },
    },
    400: { description: "No domain or name", content: errorContent },
    404: { description: "No logo available", content: errorContent },
  },
});
