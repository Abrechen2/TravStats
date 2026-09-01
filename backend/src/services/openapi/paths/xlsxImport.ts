/**
 * Spreadsheet import.
 *
 * The counterpart to the Excel export: the client parses the workbook and
 * posts its sheets as rows of strings. Documented because an automation is a
 * plausible caller — a script that keeps TravStats in step with a sheet
 * elsewhere is exactly what this shape is for.
 */

import { z } from "zod";

import { registry } from "../registry";

const rowOutcome = z.object({
  row: z.number().int().openapi({ description: "1-based row number as shown in Excel." }),
  action: z.enum(["create", "update", "skip", "error"]),
  id: z.string().nullable().openapi({
    description: "Record id. Null for a create that has not been applied yet.",
  }),
  label: z.string(),
  message: z.string().optional().openapi({
    description:
      "Reason the row was refused. `unknown_id` covers both an id that does not exist " +
      "and one belonging to another account — the two are deliberately indistinguishable.",
  }),
});

const sheetOutcome = z.object({
  key: z.string(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  errors: z.number().int(),
  rows: z.array(rowOutcome),
});

registry.registerPath({
  method: "post",
  path: "/xlsx-import",
  summary: "Apply an edited export workbook",
  description:
    "Applies rows from a TravStats Excel export. A row carrying an id updates the record " +
    "it names; a row without one is created, where the sheet supports creation. An id that " +
    "does not belong to the caller is refused, never applied.\n\n" +
    "`dryRun` defaults to **true** and writes nothing: post once to preview, then again " +
    "with `dryRun: false` to apply. Cells are sent as strings, exactly as the spreadsheet " +
    "holds them; the server coerces and validates them through the same schemas the " +
    "regular endpoints use.",
  tags: ["Import"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            dryRun: z.boolean().default(true),
            sheets: z.array(
              z.object({
                key: z.string().openapi({
                  description: "Sheet key: `places`, `cruises` or `lodging`.",
                }),
                rows: z.array(z.record(z.string(), z.string())),
              }),
            ),
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
              clean: z.boolean().openapi({
                description: "True when no sheet produced an error.",
              }),
              sheets: z.array(sheetOutcome),
            }),
          }),
        },
      },
    },
    400: { description: "Malformed request body" },
    401: { description: "Not authenticated" },
  },
});
