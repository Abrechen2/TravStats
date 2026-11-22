/**
 * The life book: a standalone offline HTML chronicle of a year, a trip or the whole logbook.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ success: z.literal(true), data });
const tags = ["Account"];

registry.registerPath({
  method: "post",
  path: "/me/life-book",
  summary: "Start building the life book (background job)",
  description:
    'Body `{ scope: "all" | "year" | "trip", year?, tripId?, lang: "de" | "en" }`. Starts a job ' +
    "(kind `lifeBook.export`, progress = trips done of total) whose result names the download " +
    "(`exportId`, `bytes`, `trips`, `entries`, `photos`, `photosSkipped`). The file is one HTML " +
    "page with inline CSS and embedded downscaled photos, no script and no external request. " +
    "Job error codes: `LIFE_BOOK_EMPTY`, `LIFE_BOOK_TOO_LARGE`. 404 `TRIP_NOT_FOUND` for a trip " +
    "that is not this account's, 409 `LIFE_BOOK_BUSY` while one runs.",
  tags,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            scope: z.enum(["all", "year", "trip"]),
            year: z.number().int().optional(),
            tripId: z.string().uuid().optional(),
            lang: z.enum(["de", "en"]).optional(),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    202: {
      description: "The job to poll at `GET /jobs/{id}`",
      content: { "application/json": { schema: envelope(z.object({ jobId: z.string().uuid() })) } },
    },
    400: { description: "LIFE_BOOK_INVALID", content: errorContent },
    404: { description: "TRIP_NOT_FOUND", content: errorContent },
    409: { description: "LIFE_BOOK_BUSY", content: errorContent },
    429: { description: "Too many requests", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/me/life-book/{exportId}",
  summary: "Download a finished life book",
  description:
    "The HTML file the job wrote. Kept for six hours; 404 once expired or for another account.",
  tags,
  request: { params: z.object({ exportId: z.string().uuid() }) },
  responses: {
    200: {
      description: "The book",
      content: { "text/html": { schema: z.string().describe("HTML") } },
    },
    404: { description: "LIFE_BOOK_NOT_FOUND", content: errorContent },
  },
});
