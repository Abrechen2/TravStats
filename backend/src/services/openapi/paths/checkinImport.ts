/** Check-in app import (forgejo#401). */

import { z } from "zod";

import { registry } from "../registry";
import { jobStartedSchema } from "./jobs";

const rowOutcome = z.object({
  row: z.number().int().openapi({
    description: "Position in the file: JSON the 1-based entry, CSV the line (header = 1).",
  }),
  action: z.enum(["create", "update", "skip", "error"]),
  id: z.string().nullable(),
  label: z.string(),
  message: z
    .string()
    .optional()
    .openapi({
      description:
        "A code. For `error` the reason the ride was refused: `unknown_station` (not matched " +
        "in the station catalogue), `invalid_date`, `missing_departure_station`, " +
        "`missing_arrival_station`, `missing_departure_time`, `not_a_journey`, `invalid_file`, " +
        "`unsupported_mode:<ferry|taxi|plane|...>`. For `skip`: `exists` (the ride is already " +
        "stored) or `duplicate_in_file`.",
    }),
  notes: z.array(z.string()).optional(),
});

registry.registerPath({
  method: "post",
  path: "/checkin-import",
  summary: "Import a Träwelling or travelynx export",
  description:
    "Reads a Träwelling export (CSV or JSON) or a travelynx JSON export and imports its " +
    "rides through the rail (and, where the source says bus, bus) import. Stations are " +
    "matched through the station catalogue; a ride that cannot be matched is returned as an " +
    "`error` row with its reason, never dropped. Times are read as the station's wall " +
    "clock; instants (UTC, epoch) are converted in the matched station's zone. Rides " +
    "already stored are recognised by the spreadsheet import's natural key and skipped " +
    "(`add` mode only). Nothing leaves the server while parsing.\n\n" +
    "`dryRun` defaults to **true** and writes nothing.",
  tags: ["Import"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            source: z.enum(["travelling", "travelynx"]),
            format: z.enum(["csv", "json"]).optional().openapi({
              description: "Omitted: JSON when the file starts with `[` or `{`, else CSV.",
            }),
            content: z.string().openapi({ description: "The file's text." }),
            dryRun: z.boolean().default(true),
            background: z.boolean().default(false).openapi({
              description: "Answer 202 with a job (poll GET /jobs/{id}).",
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "What was done, or would be done for a dry run",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              dryRun: z.boolean(),
              clean: z.boolean(),
              sheets: z.array(
                z.object({
                  key: z.enum(["rail", "bus"]),
                  created: z.number().int(),
                  updated: z.number().int(),
                  skipped: z.number().int(),
                  errors: z.number().int(),
                  rows: z.array(rowOutcome),
                })
              ),
            }),
          }),
        },
      },
    },
    202: {
      description: "Started as a background job",
      content: { "application/json": { schema: jobStartedSchema } },
    },
    400: { description: "Malformed request body" },
    401: { description: "Not authenticated" },
  },
});
