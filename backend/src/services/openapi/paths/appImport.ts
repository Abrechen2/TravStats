/** Import from other travel apps — TripIt, Polarsteps, JetLovers, FlightMemory, Logmyflight (forgejo#401). */

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
        "A code. For `error` the reason the record was refused: `invalid_file`, " +
        "`invalid_record`, `invalid_date`, `missing_airport_code`, `missing_flight_number`, " +
        "`missing_name`, `missing_coordinates`, `unknown_airport`, `unknown_station`, " +
        "`unsupported_event`, `unsupported_object:<car|transport|...>`, or a code of the " +
        "spreadsheet import (`flight_needs_route`, `ambiguous_place`, ...). For `skip`: " +
        "`exists` (already stored) or `duplicate_in_file`.",
    }),
  notes: z.array(z.string()).optional(),
});

registry.registerPath({
  method: "post",
  path: "/app-import",
  summary: "Import an export of another travel app",
  description:
    "Reads a TripIt export (API JSON or iCal feed), a Polarsteps `trip.json`, or a JetLovers, " +
    "FlightMemory or Logmyflight CSV, and imports it through the spreadsheet import in add " +
    "mode: flights, rail rides, lodging and stays, places and visits. Entries already stored " +
    "are recognised by the spreadsheet import's natural key and skipped; a record that cannot " +
    "be used is returned as an `error` row with its reason, never dropped. Flight clocks are " +
    "read as the airports' wall clocks. The formats of the five sources are built from their " +
    "documented export shapes, not from real files.\n\n" +
    "`dryRun` defaults to **true** and writes nothing.",
  tags: ["Import"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            source: z.enum(["tripit", "polarsteps", "jetlovers", "flightmemory", "logmyflight"]),
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
                  key: z.string().openapi({
                    description:
                      "Importer sheet: flights, rail, bus, lodging, lodgingStays, places, placeVisits, or other.",
                  }),
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
    400: {
      description:
        "Malformed request body, or a file with more than 5000 records (`code: IMPORT_TOO_MANY_ROWS`; " +
        "refused while parsing, before any station is looked up)",
    },
    401: { description: "Not authenticated" },
  },
});
