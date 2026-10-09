/**
 * Shared trips, phase S1 (`routes/sharing.ts`, design
 * `docs/superpowers/specs/2026-10-09-trip-sharing-design.md`). Enveloped.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  companionLinkSchema,
  consentRequestSchema,
  shareTripSchema,
} from "../../../routes/sharing";

const tags = ["Sharing"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: {
    "application/json": { schema: z.object({ success: z.literal(true), data }) },
  },
});
const instant = z.string().datetime();

const person = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string().describe("First and last name, or the username when neither is set"),
});

const consent = z.object({
  id: z.string(),
  status: z.enum(["pending", "accepted", "declined", "withdrawn"]),
  createdAt: instant,
  decidedAt: instant.nullable(),
  person: person.describe("The other side of the pair"),
});

const linkable = z.object({ id: z.string(), name: z.string(), linkedUser: person.nullable() });
const counts = z.object({
  flights: z.number().int(),
  lodgingStays: z.number().int(),
  cruises: z.number().int(),
  railJourneys: z.number().int(),
  rentals: z.number().int(),
  stops: z.number().int(),
});
const notice = z.object({
  id: z.string(),
  kind: z.enum(["shared", "created", "updated", "deleted", "left"]),
  entityType: z.string().nullable(),
  entityKey: z
    .string()
    .nullable()
    .describe("The entry's shareKey; for `trip` the caller's own trip id"),
  after: z.unknown().nullable(),
  createdAt: instant,
  readAt: instant.nullable(),
  actor: person.nullable(),
});

const idParam = z.object({ id: z.string() });
const tripParam = z.object({ tripId: z.string() });
const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { "application/json": { schema } },
});
const consentNotFound = err("`SHARE_CONSENT_NOT_FOUND`: no consent of the caller under that id");

registry.registerPath({
  method: "get",
  path: "/sharing/consents",
  summary: "The caller's consents, both directions",
  tags,
  responses: {
    200: ok(
      "Incoming (asked of the caller) and outgoing (asked by the caller), newest first",
      z.object({ incoming: z.array(consent), outgoing: z.array(consent) })
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/consents",
  summary: "Ask an account on this server for consent to share trips into it",
  description:
    "A declined or withdrawn pair is asked again. Limited to 30 requests an hour per user.",
  tags,
  request: { body: json(consentRequestSchema) },
  responses: {
    201: ok("The pending consent", consent),
    400: err("`SHARE_SELF`: the caller's own username; or invalid input"),
    404: err("`SHARE_USER_NOT_FOUND`: no active account of that name on this server"),
    409: err("`SHARE_CONSENT_DUPLICATE`: already pending or accepted (`status` says which)"),
  },
});

for (const action of ["accept", "decline"] as const) {
  registry.registerPath({
    method: "post",
    path: `/sharing/consents/{id}/${action}`,
    summary: action === "accept" ? "Accept a consent request" : "Decline a consent request",
    description: "Only the asked account answers, and only while the request is pending.",
    tags,
    request: { params: idParam },
    responses: {
      200: ok("The answered consent", consent),
      404: consentNotFound,
      409: err("`SHARE_CONSENT_NOT_PENDING`: already answered (`status` says how)"),
    },
  });
}

registry.registerPath({
  method: "post",
  path: "/sharing/consents/{id}/withdraw",
  summary: "Withdraw a consent (either side)",
  description: "Copies already made stay as independent trips; further shares are refused.",
  tags,
  request: { params: idParam },
  responses: { 200: ok("The withdrawn consent", consent), 404: consentNotFound },
});

registry.registerPath({
  method: "get",
  path: "/sharing/companions",
  summary: "The caller's companions with their account link",
  tags,
  responses: {
    200: ok(
      "Companions, and the accounts that accepted the caller's consent request",
      z.object({ companions: z.array(linkable), linkableUsers: z.array(person) })
    ),
  },
});

registry.registerPath({
  method: "put",
  path: "/sharing/companions/{id}/link",
  summary: "Link a companion to an account",
  tags,
  request: { params: idParam, body: json(companionLinkSchema) },
  responses: {
    200: ok("The linked companion", linkable),
    400: err("`SHARE_SELF`: the caller's own account"),
    403: err("`SHARE_CONSENT_REQUIRED`: that account has not accepted sharing from the caller"),
    404: err("`COMPANION_NOT_FOUND`"),
    409: err("`SHARE_COMPANION_ALREADY_LINKED`: another companion is linked to that account"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/sharing/companions/{id}/link",
  summary: "Unlink a companion from its account",
  tags,
  request: { params: idParam },
  responses: { 200: ok("The unlinked companion", linkable), 404: err("`COMPANION_NOT_FOUND`") },
});

registry.registerPath({
  method: "get",
  path: "/sharing/trips/{tripId}",
  summary: "Who shares this trip, and with whom it could be shared",
  tags,
  request: { params: tripParam },
  responses: {
    200: ok(
      "Members besides the caller, and the caller's linked companions",
      z.object({
        groupId: z.string().nullable(),
        members: z.array(person),
        candidates: z.array(
          z.object({
            companionId: z.string(),
            name: z.string(),
            user: person,
            consenting: z.boolean(),
            shared: z.boolean(),
          })
        ),
      })
    ),
    404: err("`TRIP_NOT_FOUND`"),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/trips/{tripId}/share",
  summary: "Share a trip with a linked companion",
  description:
    "One transaction: copies the trip and every flight, stay, cruise, rail ride, rental and " +
    "timeline stop into the companion's account — facts only — and joins both copies in a " +
    "share group. Idempotent: entries the other account already holds are not copied again.",
  tags,
  request: { params: tripParam, body: json(shareTripSchema) },
  responses: {
    200: ok(
      "What was created in the other account",
      z.object({ groupId: z.string(), tripCreated: z.boolean(), created: counts })
    ),
    403: err("`SHARE_CONSENT_REQUIRED`"),
    404: err("`TRIP_NOT_FOUND` or `COMPANION_NOT_FOUND`"),
    409: err("`SHARE_COMPANION_NOT_LINKED`"),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/trips/{tripId}/leave",
  summary: "Leave a trip's share group",
  description: "The caller's copy stays as an ordinary trip; the other members get a notice.",
  tags,
  request: { params: tripParam },
  responses: {
    200: ok("Left", z.object({ left: z.literal(true) })),
    404: err("`TRIP_NOT_FOUND`"),
    409: err("`SHARE_TRIP_NOT_SHARED`"),
  },
});

registry.registerPath({
  method: "get",
  path: "/sharing/notices",
  summary: "Notices about shared trips, newest first (up to 200)",
  tags,
  responses: { 200: ok("Notices", z.object({ notices: z.array(notice) })) },
});

registry.registerPath({
  method: "post",
  path: "/sharing/notices/{id}/read",
  summary: "Mark a sharing notice read",
  tags,
  request: { params: idParam },
  responses: {
    200: ok("Read", z.object({ read: z.boolean() })),
    404: err("`SHARE_NOTICE_NOT_FOUND`"),
  },
});

registry.registerPath({
  method: "get",
  path: "/sharing/inbox/count",
  summary: "Open consent requests plus unread sharing notices",
  tags,
  responses: { 200: ok("The inbox badge's share", z.object({ count: z.number().int() })) },
});
