/**
 * One person, one companion (2026-11-24): a companion linked to a person on another server, the
 * same-name repair, and the trips shared with the caller that the dashboard and nav announce.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { companionNotSameSchema, companionRemoteSchema } from "../../../routes/sharing";

const tags = ["Sharing"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: {
    "application/json": { schema: z.object({ success: z.literal(true), data }) },
  },
});
const idParam = z.object({ id: z.string() });
const tripParam = z.object({ tripId: z.string() });
const done = z.object({ ok: z.literal(true) });
const companionRef = z.object({ id: z.string(), name: z.string() });
const remotePerson = z.object({
  remoteId: z.string(),
  displayName: z.string(),
  username: z.string(),
  origin: z.string(),
});

registry.registerPath({
  method: "put",
  path: "/sharing/companions/{id}/remote-link",
  summary: "Link a companion to a person on another server",
  description:
    "The owner's confirmation that this companion IS the paired person — afterwards every surface lists them once. Unlinked again with `DELETE /sharing/companions/{id}/link`.",
  tags,
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: companionRemoteSchema } } },
  },
  responses: {
    200: ok("The linked companion", companionRef.extend({ remoteId: z.string() })),
    404: err("`COMPANION_NOT_FOUND`, or `SHARE_REMOTE_PERSON_NOT_FOUND`"),
    409: err("`SHARE_COMPANION_ALREADY_LINKED`: this or another companion is linked already"),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/companions/{id}/not-same",
  summary: "Say a companion is not a person on another server, or not a member of this one",
  description:
    "Remembered, so the same-name question is not asked again. `remoteId` names a pairing; " +
    "`userId` an account of this server that shares a trip group with the caller.",
  tags,
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: companionNotSameSchema } } },
  },
  responses: {
    200: ok("Remembered", done),
    404: err("`COMPANION_NOT_FOUND`, `SHARE_REMOTE_PERSON_NOT_FOUND`, or `SHARE_MEMBER_NOT_FOUND`"),
  },
});

registry.registerPath({
  method: "get",
  path: "/sharing/trips/{tripId}/companion-duplicates",
  summary: "People listed twice on a trip",
  description:
    "A person on another server on the trip and an unlinked companion of the same name (case, accents and word order folded), each with a one-click link.",
  tags,
  request: { params: tripParam },
  responses: {
    200: ok(
      "The duplicates",
      z.object({
        duplicates: z.array(
          z.object({
            tripId: z.string(),
            tripName: z.string(),
            remote: remotePerson,
            companion: companionRef,
          })
        ),
      })
    ),
    404: err("`TRIP_NOT_FOUND`"),
  },
});

registry.registerPath({
  method: "get",
  path: "/sharing/received-trips",
  summary: "Trips shared with the caller, not looked at yet",
  description:
    "Arrived trips with an unread notice (taken by the caller's consent or accept) and offers from other servers still waiting for an answer — the dashboard banner and the dot on Reisen.",
  tags,
  responses: {
    200: ok(
      "The trips",
      z.object({
        items: z.array(
          z.object({
            kind: z.enum(["shared", "offer"]),
            id: z.string(),
            tripId: z.string().nullable(),
            tripName: z.string(),
            from: z.object({ displayName: z.string(), origin: z.string().nullable() }),
            autoAccepted: z.boolean(),
          })
        ),
        count: z.number().int(),
      })
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/received-trips/seen",
  summary: "The banner was seen",
  description: "Arrived trips count as read; offers stay until answered.",
  tags,
  responses: { 200: ok("Seen", done) },
});
