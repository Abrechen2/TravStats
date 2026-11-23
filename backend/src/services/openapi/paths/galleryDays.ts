/** The gallery's day-wise reading of a linked photo-source album. */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const notFound = { description: "Not found", content: errorContent };
const uuid = z.string().uuid();
const immichTag = ["Immich"];

registry.registerPath({
  method: "get",
  path: "/trips/{id}/immich/albums/{linkId}/days",
  summary: "Photos per local day of a linked album (counts only)",
  description:
    "Days are cut in the caller's profile zone. No asset is listed; the gallery asks " +
    "for one day's photos next. A provider failure answers 502 with its kind.",
  tags: immichTag,
  request: { params: z.object({ id: uuid, linkId: uuid }) },
  responses: {
    200: {
      description: "Day counts",
      content: {
        "application/json": {
          schema: z.object({
            zone: z.string(),
            truncated: z.boolean(),
            total: z.number().int(),
            days: z.array(z.object({ day: z.string().nullable(), count: z.number().int() })),
          }),
        },
      },
    },
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/trips/{id}/immich/albums/{linkId}/days/{day}/assets",
  summary: "One day's photos of a linked album, paged",
  description: "`day` is `YYYY-MM-DD`, `undated` or `all`. `limit` is 1-200 (default 60).",
  tags: immichTag,
  request: { params: z.object({ id: uuid, linkId: uuid, day: z.string() }) },
  responses: {
    200: {
      description: "A page of assets",
      content: {
        "application/json": {
          schema: z.object({
            day: z.string(),
            total: z.number().int(),
            offset: z.number().int(),
            nextOffset: z.number().int().nullable(),
            assets: z.array(
              z.object({
                id: z.string(),
                url: z.string(),
                previewUrl: z.string(),
                takenAt: z.string().nullable(),
                lat: z.number().nullable(),
                lon: z.number().nullable(),
              })
            ),
          }),
        },
      },
    },
    400: { description: "Invalid day or page" },
    404: notFound,
  },
});
