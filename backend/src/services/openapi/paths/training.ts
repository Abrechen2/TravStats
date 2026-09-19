/**
 * The parser workshop: the samples a user uploads, annotates, lists and
 * deletes again.
 *
 * Split out of `integrations.ts` rather than left in it. Registering the list
 * and the delete (beta API audit of 2026-09-19, unlisted finding 3) pushed
 * that file past the 800-line ratchet, and these five endpoints are the one
 * self-contained group in it — they share a tag, a router and a lifecycle,
 * and nothing else in `integrations.ts` refers to them.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { WORKSHOP_DOMAINS } from "../../../shared/annotationLabels";

const badInput = { description: "Invalid input", content: errorContent };
const notFound = { description: "Not found", content: errorContent };
const deleted = { description: "Deleted" };
const uuid = z.string().uuid();
const parseTag = ["Parsing"];

registry.registerPath({
  method: "post",
  path: "/training/upload",
  summary: "Upload a document to improve parsing",
  tags: parseTag,
  responses: { 201: { description: "Uploaded" }, 400: badInput },
});

/** One row of the training list — the sample without its annotation blob. */
const trainingSample = z.object({
  id: uuid,
  type: z
    .enum(["email", "boarding_pass"])
    .describe("The MEDIUM the sample is. `domain` beside it says what it is ABOUT."),
  // WORKSHOP_DOMAINS, not PARSER_SUPPORTED_DOMAINS: the workshop also
  // annotates PLACES, which no parse endpoint accepts, so the narrower list
  // would describe a value the column can hold as impossible.
  domain: z.enum(WORKSHOP_DOMAINS).describe("What the workshop will derive a template for."),
  status: z.enum(["pending", "trained", "failed"]),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  filename: z.string().describe("The stored file's name — never its path."),
});

registry.registerPath({
  method: "get",
  path: "/training",
  summary: "Your own training samples, newest first",
  description:
    "The annotation blob is left out: it carries the whole mail text, or a boarding pass as base64. Read one sample by id for that. Newest first, bounded by `limit`.",
  tags: parseTag,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().describe("Default 50"),
    }),
  },
  responses: {
    200: {
      description: "Samples",
      content: {
        "application/json": { schema: z.object({ samples: z.array(trainingSample) }) },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/training/{id}",
  summary: "Delete a training sample, and the file behind it",
  description:
    "Another user's id is answered 404, not 403 — the difference between the two would confirm that the id exists.",
  tags: parseTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 204: deleted, 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/training/{id}",
  summary: "One training document",
  tags: parseTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Document" }, 404: notFound },
});

registry.registerPath({
  method: "post",
  path: "/training/{id}/annotate",
  summary: "Say what a training document should have produced",
  tags: parseTag,
  request: { params: z.object({ id: uuid }) },
  responses: { 200: { description: "Annotated" }, 400: badInput, 404: notFound },
});
