/**
 * Country flags — SVG from the vendored `flag-icons` package.
 *
 * Reference data, not user data: the answer for `DE` is the same for every
 * account and every day, which is why both endpoints carry a day-long
 * private cache and an ETag, and why a 404 is an answer worth caching too.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Geo"];
const variant = z
  .enum(["flat", "square"])
  .optional()
  .describe("`flat` is the 4:3 flag (default), `square` the 1:1 crop.");
const notModified = { description: "Not modified — the `If-None-Match` tag still holds" };
const badInput = { description: "Not an ISO 3166-1 alpha-2 code, or an invalid variant", content: errorContent };

registry.registerPath({
  method: "get",
  path: "/country-flags",
  summary: "Several country flags in one answer",
  description:
    "Up to 250 comma-separated ISO 3166-1 alpha-2 codes, case-insensitive. " +
    "Known codes come back as inline SVG markup keyed by upper-cased code; " +
    "well-formed codes with no flag are listed under `missing` rather than " +
    "failing the whole request. One malformed code fails it with 400.",
  tags,
  request: {
    query: z.object({
      codes: z.string().describe("Comma-separated alpha-2 codes, e.g. `DE,FR,IT`"),
      variant,
    }),
  },
  responses: {
    200: {
      description: "Flags by code, and the codes with no flag",
      content: {
        "application/json": {
          schema: z.object({
            flags: z.record(z.string().describe("SVG markup")),
            missing: z.array(z.string().length(2)),
          }),
        },
      },
    },
    304: notModified,
    400: badInput,
  },
});

registry.registerPath({
  method: "get",
  path: "/country-flags/{iso}",
  summary: "One country's flag",
  description:
    "SVG bytes with a strong ETag and `Cache-Control: private, max-age=86400`. " +
    "Send the ETag back as `If-None-Match` to get a 304. A well-formed code the " +
    "package has no flag for answers 404 with `{ error: \"unknown_country\" }` — " +
    "that is a stable answer, cache it like a hit.",
  tags,
  request: {
    params: z.object({ iso: z.string().length(2).describe("ISO 3166-1 alpha-2, case-insensitive") }),
    query: z.object({ variant }),
  },
  responses: {
    200: { description: "SVG bytes", content: { "image/svg+xml": { schema: z.string() } } },
    304: notModified,
    400: badInput,
    404: { description: "No flag for this code", content: errorContent },
  },
});
