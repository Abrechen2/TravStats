/**
 * "Dieses Dokument belegt auch …" (plan D4 of
 * docs/superpowers/specs/2026-11-21-document-links.md): stored documents
 * whose parse reading names entries of their trip they are not linked to.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Documents"];
const notFound = {
  description: "`DOCUMENT_LINK_SUGGESTION_NOT_FOUND`: nothing pending to decide — reload",
  content: errorContent,
};

const pass = z.object({
  jobId: z
    .string()
    .nullable()
    .describe(
      "The scan of stored documents, when one is running or was started by this request; poll `GET /jobs/{id}`"
    ),
});

const suggestion = z.object({
  documentId: z.string(),
  displayName: z.string(),
  kind: z.string().nullable(),
  entries: z.array(
    z.object({
      suggestionId: z.string(),
      entry: z.object({ type: z.string(), id: z.string() }),
      label: z.string(),
      reason: z
        .enum([
          "bookingReference",
          "flightNumber",
          "trainNumber",
          "lineName",
          "hotelDates",
          "dateRange",
        ])
        .describe("Which field of the document's reading matched the entry"),
    })
  ),
});

registry.registerPath({
  method: "get",
  path: "/document-link-suggestions",
  summary: "Documents that also cover other entries of their trip",
  description:
    "Own documents and own transport, lodging and rental entries only — never a place visit. " +
    "The first read for an account starts one scan of every stored document (a job, see `pass`); " +
    "later reads rescan only documents created or filed since. A decision is remembered by the " +
    "entry's content key and never asked twice.",
  tags,
  responses: {
    200: {
      description: "Pending proposals grouped by document",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ suggestions: z.array(suggestion), total: z.number().int(), pass }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/document-link-suggestions/count",
  summary: "How many documents have link suggestions open",
  tags,
  responses: {
    200: {
      description: "The inbox badge's number",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ count: z.number().int(), pass }),
          }),
        },
      },
    },
  },
});

const idParam = z.object({ documentId: z.string() });
const idsBody = z.object({
  suggestionIds: z
    .array(z.string())
    .optional()
    .describe("The ticked entries; absent = all pending of the document"),
});

registry.registerPath({
  method: "post",
  path: "/document-link-suggestions/{documentId}/accept",
  summary: "Link a document to the suggested entries",
  description:
    "One transaction: `covers` links with provenance `suggestion`. An entry deleted meanwhile is " +
    "skipped and counted in `skipped`.",
  tags,
  request: { params: idParam, body: { content: { "application/json": { schema: idsBody } } } },
  responses: {
    200: {
      description: "How many links were written",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ linked: z.number().int(), skipped: z.number().int() }),
          }),
        },
      },
    },
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/document-link-suggestions/{documentId}/dismiss",
  summary: "Dismiss link suggestions of a document",
  description: "Remembered by content key: the entry is not proposed for this document again.",
  tags,
  request: { params: idParam, body: { content: { "application/json": { schema: idsBody } } } },
  responses: {
    200: {
      description: "How many proposals were dismissed",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            data: z.object({ dismissed: z.number().int() }),
          }),
        },
      },
    },
    404: notFound,
  },
});
