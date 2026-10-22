/**
 * Rich map details (2026-10-21): a picture of a journey's vessel, car model or
 * train category for the map's hover profile, and the Wikipedia opening of a
 * station / terminal / port / rental branch for its point card. Server side,
 * only for what the caller's own rows record; pictures free-licensed and
 * credited.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const subjectQuery = z.object({
  kind: z.enum(["vessel", "vehicle", "train"]),
  name: z.string().min(1).max(120),
});

const credit = registry.register(
  "SubjectImageCredit",
  z
    .object({
      qid: z.string().describe("The Wikidata item the picture was read from"),
      file: z.string().describe("The Commons file name"),
      licence: z.string().describe("Licence as Commons names it, e.g. 'CC BY-SA 4.0'"),
      licenceUrl: z.string().nullable(),
      artist: z.string().nullable().describe("The author, plain text, when stated"),
      sourceUrl: z.string().describe("The file's page on Commons"),
    })
    .openapi("SubjectImageCredit")
);

const subject = registry.register(
  "SubjectImage",
  z
    .object({
      available: z.boolean(),
      pending: z
        .boolean()
        .describe("A lookup is still running or was deferred; ask again on a later view"),
      unavailable: z
        .boolean()
        .describe(
          "Wikimedia did not answer (timeout, 429, 5xx): could not ask — not 'no picture'. " +
            "Not cached; ask again later"
        ),
      credit: credit.nullable(),
    })
    .openapi("SubjectImage")
);

registry.registerPath({
  method: "get",
  path: "/map-details/subject",
  tags: ["Map details"],
  summary: "Whether a vessel, car model or train category has a picture, and its credit",
  description:
    "Only a name the caller's own journeys record is looked up (a ferry's vessel, a rental's " +
    "vehicle example, a train category). Wikidata item whose label is the name and whose " +
    "description names the kind; its image from Commons, free licences only. Only while the " +
    "admin switch `operatorLogosOpenDataEnabled` is on. `available: false` with " +
    "`unavailable: false` and `pending: false` means no picture.",
  request: { query: subjectQuery },
  responses: {
    200: {
      description: "Whether there is a picture",
      content: {
        "application/json": { schema: z.object({ success: z.literal(true), data: subject }) },
      },
    },
    400: { description: "No kind or name", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/map-details/subject/image",
  tags: ["Map details"],
  summary: "A vessel's, car model's or train category's picture",
  description:
    "Commons' raster thumbnail (≤ 320 px), `Cache-Control: private`. 404 when there is none.",
  request: { query: subjectQuery },
  responses: {
    200: {
      description: "Raster picture",
      content: { "image/jpeg": { schema: z.string().openapi({ format: "binary" }) } },
    },
    400: { description: "No kind or name", content: errorContent },
    404: { description: "No picture available", content: errorContent },
    503: { description: "Wikimedia did not answer; ask again later", content: errorContent },
  },
});

const stopSummary = registry.register(
  "StopWikipediaSummary",
  z
    .object({
      title: z.string(),
      extract: z.string().describe("The article's first two sentences"),
      thumbnailUrl: z.string().nullable(),
      pageUrl: z.string(),
      lang: z.enum(["de", "en"]),
    })
    .openapi("StopWikipediaSummary")
);

registry.registerPath({
  method: "get",
  path: "/map-details/stop",
  tags: ["Map details"],
  summary: "The Wikipedia opening of the article about one of the caller's stations",
  description:
    "Only for a point within ~250 m of an end of one of the caller's own journeys of that " +
    "domain. Found by place (Wikipedia geosearch, 500 m) and confirmed by name; `summary: null` " +
    "when no article is confidently the stop. `unavailable: true` when Wikipedia did not answer.",
  request: {
    query: z.object({
      domain: z.enum(["rail", "bus", "ferry", "rental"]),
      name: z.string().min(1).max(160),
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      lang: z.enum(["de", "en"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "The summary, or null",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ summary: stopSummary.nullable(), unavailable: z.boolean() }),
          }),
        },
      },
    },
    400: { description: "Missing or invalid query", content: errorContent },
    409: { description: "The instance's open-data switch is off", content: errorContent },
  },
});
