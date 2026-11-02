/**
 * Plans on another server through a user connection (`routes/remotePlans.ts`, spec
 * `docs/superpowers/specs/2026-11-02-user-connections.md` §4). Enveloped. The server-to-server
 * messages (`plan-*`) travel on `/trip-share-peer`, which is out of the spec.
 */
import { z } from "zod";
import { registry } from "../registry";
import { writeSchema } from "../../travplan/schema";
import { errorContent } from "./shared";
import { member, result as planView } from "./travplan";

const tags = ["Remote plans"];
const uuid = z.string().uuid();
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
});
const ids = z.object({
  connectionId: uuid.describe("The caller's connection with the plan's owner"),
  planId: uuid,
});

const summary = z.object({
  connectionId: uuid,
  origin: z.string().describe("The host's server"),
  planId: uuid,
  tripId: uuid.describe("The trip on the host; only the host knows it"),
  title: z.string(),
  ownerDisplayName: z.string(),
  role: z.literal("editor"),
  state: z.enum(["invited", "active"]),
});
const documentDto = z.object({
  id: uuid,
  displayName: z.string(),
  mimetype: z.string(),
  format: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string().datetime(),
  uploadedBy: z.object({ memberId: uuid, displayName: z.string() }).nullable(),
  bookingId: uuid.nullable(),
  attached: z.boolean(),
  url: z.string(),
});
const errors = {
  401: err("Not signed in"),
  403: err("`REMOTE_PLAN_NOT_SHARED`: the connection, a switch or the membership ended"),
  404: err("`REMOTE_PLAN_NOT_FOUND`, or `SHARE_REMOTE_DISABLED` while federation is off"),
  429: err("`REMOTE_PLAN_RATE_LIMITED`"),
  503: err("`REMOTE_PLAN_UNREACHABLE`: the host does not answer; keep the queue and retry"),
};

registry.registerPath({
  method: "get",
  path: "/remote-plans",
  summary: "Plans on other servers the caller is invited to or works on",
  description:
    "Invitations come with `state: invited`. A plan whose connection or membership ended is not listed.",
  tags,
  responses: { 200: ok("The plans", z.array(summary)), ...errors },
});
registry.registerPath({
  method: "get",
  path: "/remote-plans/{connectionId}/{planId}",
  summary: "The plan view, as the owner route returns it",
  description:
    "Carries an `ETag`. `If-None-Match` is answered 304 from this server's read cache (younger than five seconds) without asking the host; otherwise the host's ETag is passed through. Limit 600 reads a minute per person.",
  tags,
  request: { params: ids },
  responses: { 200: ok("The plan", planView), 304: { description: "Not modified" }, ...errors },
});
registry.registerPath({
  method: "post",
  path: "/remote-plans/{connectionId}/{planId}/mutations",
  summary: "A plan write",
  description:
    "The same body as the owner route (`clientRef`, `baseRevision`, `operation`), forwarded unchanged: a replay after a 503 meets the host's stored receipt, never a second mutation. 409 `PLAN_REVISION_CONFLICT` and the plan's other refusals pass through with their codes. Limit 120 writes a minute per person.",
  tags,
  request: { params: ids, body: { content: { "application/json": { schema: writeSchema } } } },
  responses: { 200: ok("The plan after the write", planView), 409: err("Conflict"), ...errors },
});
registry.registerPath({
  method: "get",
  path: "/remote-plans/{connectionId}/{planId}/collab",
  summary: "Who is on the plan and what the others changed",
  tags,
  request: { params: ids },
  responses: {
    200: ok(
      "Members and unread notices",
      z.object({
        self: z.object({
          memberId: uuid,
          kind: z.enum(["owner", "local", "remote"]),
          isOwner: z.boolean(),
        }),
        members: z.array(member),
        notices: z.array(
          z.object({
            id: uuid,
            actorName: z.string(),
            summary: z.string(),
            createdAt: z.string().datetime(),
          })
        ),
      })
    ),
    ...errors,
  },
});
registry.registerPath({
  method: "post",
  path: "/remote-plans/{connectionId}/{planId}/notices/read",
  summary: "Mark the caller's notices read",
  tags,
  request: { params: ids },
  responses: { 200: ok("How many", z.object({ read: z.number().int() })), ...errors },
});
registry.registerPath({
  method: "get",
  path: "/remote-plans/{connectionId}/{planId}/documents",
  summary: "The plan's documents the caller may see",
  tags,
  request: { params: ids },
  responses: { 200: ok("The documents", z.object({ documents: z.array(documentDto) })), ...errors },
});
registry.registerPath({
  method: "post",
  path: "/remote-plans/{connectionId}/{planId}/documents",
  summary: "Upload a document to the plan",
  description:
    "Multipart field `file` (at most 20 MB), optional `bookingId`. At most 50 documents per member (409 `PLAN_DOCUMENT_LIMIT`).",
  tags,
  request: {
    params: ids,
    body: { content: { "application/json": { schema: z.object({ bookingId: uuid.optional() }) } } },
  },
  responses: {
    201: ok("The document", documentDto),
    413: err("`PLAN_DOCUMENT_TOO_LARGE`"),
    ...errors,
  },
});
registry.registerPath({
  method: "get",
  path: "/remote-plans/{connectionId}/{planId}/documents/{documentId}/file",
  summary: "The bytes of a plan document, as an attachment",
  tags,
  request: { params: ids.extend({ documentId: uuid }) },
  responses: {
    200: {
      description: "The file",
      content: { "application/octet-stream": { schema: z.string().describe("The file") } },
    },
    ...errors,
  },
});
registry.registerPath({
  method: "get",
  path: "/remote-plans/{connectionId}/{planId}/export",
  summary: "The plan's trip as a .travstats file, scoped to what the plan shows a member",
  tags,
  request: { params: ids },
  responses: {
    200: {
      description: "A zip archive",
      content: { "application/zip": { schema: z.string().describe("The archive") } },
    },
    ...errors,
  },
});
const answer = (action: string, key: string) =>
  registry.registerPath({
    method: "post",
    path: `/remote-plans/{connectionId}/{planId}/${action}`,
    summary:
      action === "accept"
        ? "Accept a plan invitation"
        : action === "decline"
          ? "Decline a plan invitation"
          : "Leave the plan",
    description:
      action === "accept"
        ? "The host must take the join first; a miss changes nothing and can be tried again (503 `REMOTE_PLAN_UNREACHABLE`)."
        : "Ends here at once; the host is told through a retried outbox.",
    tags,
    request: { params: ids },
    responses: {
      200: ok("Done", action === "accept" ? summary : z.object({ [key]: z.literal(true) })),
      ...errors,
    },
  });
answer("accept", "");
answer("decline", "declined");
answer("leave", "left");
