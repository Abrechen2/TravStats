/**
 * "Aus der Erinnerung" (docs/superpowers/specs/2026-11-22-remembered-facts.md): marking an entry
 * as remembered or recorded, and the notices a record's contradiction of a recollection raises.
 */

import { z } from "zod";

import { PROVENANCES, PROVENANCE_ENTRY_TYPES } from "../../../schemas/provenance";
import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Provenance"];

const state = z.object({
  provenance: z
    .enum(PROVENANCES)
    .nullable()
    .describe("null: unknown (an entry older than the field)"),
  rememberedOn: z.string().nullable().describe("`YYYY-MM-DD`, the day it was written down"),
  rememberedNote: z.string().nullable().describe("The user's own words, e.g. 'Sommer 1998'"),
});

const reading = z.object({
  type: z.string(),
  id: z.string(),
  label: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});

registry.registerPath({
  method: "put",
  path: "/provenance/{entryType}/{id}",
  summary: "Mark an entry as remembered or recorded, or clear the mark",
  description:
    "`entryType` is one of " +
    PROVENANCE_ENTRY_TYPES.join(", ") +
    ". `provenance: null` clears the mark and with it the date and note. Own entries only.",
  tags,
  request: {
    params: z.object({ entryType: z.enum(PROVENANCE_ENTRY_TYPES), id: z.string().uuid() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            provenance: z.enum(PROVENANCES).nullable(),
            rememberedOn: z.string().nullable().optional(),
            rememberedNote: z.string().max(500).nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "The stored mark",
      content: {
        "application/json": { schema: z.object({ success: z.literal(true), data: state }) },
      },
    },
    404: { description: "`ENTRY_NOT_FOUND`", content: errorContent },
  },
});

registry.registerPath({
  method: "get",
  path: "/provenance/notices",
  summary: "Recollections that a record contradicts",
  description:
    "Reading the list brings the notices in line with the data first. A remembered span only " +
    "contradicts a recorded date that lies more than a day outside it. Nothing is overwritten.",
  tags,
  responses: {
    200: {
      description: "Pending notices",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({
              total: z.number().int(),
              notices: z.array(
                z.object({
                  id: z.string(),
                  entryType: z.string(),
                  entryId: z.string(),
                  kind: z.enum(["outsideRememberedSpan", "outsideRecordedSpan"]),
                  detail: z.object({ remembered: reading, recorded: reading }),
                  createdAt: z.string(),
                })
              ),
            }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/provenance/notices/count",
  summary: "The inbox badge's number of memory/record contradictions",
  tags,
  responses: {
    200: {
      description: "Pending notices",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ count: z.number().int() }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/provenance/notices/{id}/dismiss",
  summary: "Keep both readings: dismiss a contradiction notice",
  tags,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Dismissed",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ dismissed: z.literal(true) }),
          }),
        },
      },
    },
    404: { description: "`PROVENANCE_NOTICE_NOT_FOUND`: nothing pending", content: errorContent },
  },
});
