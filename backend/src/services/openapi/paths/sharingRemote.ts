/**
 * Trip sharing across servers, phase F-S4b (`routes/sharingRemote.ts`, spec
 * `docs/superpowers/specs/2026-10-20-federated-trip-sharing-design.md`). Enveloped. The
 * server-to-server route `/trip-share-peer` is out of the spec, like `/comparison-peer`.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  createdRemoteInviteSchema,
  remoteClaimBodySchema,
  remoteInviteSchema,
  remotePersonSchema,
  remoteStatusSchema,
} from "../../../schemas/sharingRemote";

const tags = ["Sharing"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
});
const disabled = err(
  "`SHARE_REMOTE_DISABLED`: trip sharing across servers is switched off on this server"
);

registry.registerPath({
  method: "get",
  path: "/sharing/remote/status",
  summary: "Whether this server shares trips with other servers",
  description:
    "Answers while the feature is off too, so a client can leave the section out instead of offering a button that always fails.",
  tags,
  responses: { 200: ok("Availability and this server's origin", remoteStatusSchema) },
});

registry.registerPath({
  method: "get",
  path: "/sharing/remote/invites",
  summary: "The caller's invitation codes that can still be redeemed",
  description: "Unused and unexpired, newest first. The code itself is never shown again.",
  tags,
  responses: { 200: ok("Open invitations", z.array(remoteInviteSchema)), 404: disabled },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/invites",
  summary: "Issue an invitation code for a person on another server",
  description:
    "Single use, valid 72 hours, bound to the caller. At most 20 open at once; limited to 30 issued or redeemed an hour per user.",
  tags,
  responses: {
    201: ok("The new invitation, with its code shown this once", createdRemoteInviteSchema),
    404: disabled,
    429: err("`SHARE_REMOTE_INVITE_LIMIT`: 20 invitations are already open"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/sharing/remote/invites/{id}",
  summary: "Withdraw an unused invitation code",
  tags,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: ok("Withdrawn", z.object({ revoked: z.literal(true) })),
    404: err(
      "`SHARE_REMOTE_INVITE_NOT_FOUND`: no open invitation of the caller under that id; or `SHARE_REMOTE_DISABLED`"
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/claim",
  summary: "Redeem a code from a person on another server",
  description:
    "The code names the inviting server (`<origin>#trip:<64 hex>`); this server asks it, and both people's consent to share trips is recorded. Every failure has its own code; `extra.origin` names the other server where it matters.",
  tags,
  request: { body: { content: { "application/json": { schema: remoteClaimBodySchema } } } },
  responses: {
    201: ok("The person, now paired with the caller", remotePersonSchema),
    400: err(
      "`SHARE_REMOTE_INVITE_INVALID` (not a code, or unknown or withdrawn there), `SHARE_REMOTE_INVITE_WRONG_TAG` (a leaderboard code), `SHARE_REMOTE_INVITE_USED`, `SHARE_REMOTE_INVITE_EXPIRED`, `SHARE_REMOTE_INVITE_OWN_SERVER`"
    ),
    403: err("`SHARE_REMOTE_PEER_NOT_ADMITTED`: this server's admin has not admitted that server"),
    404: disabled,
    409: err(
      "`SHARE_REMOTE_PEER_DISABLED` (off or absent there), `SHARE_REMOTE_PEER_OUTDATED`, `SHARE_REMOTE_DUPLICATE` (already paired with that person)"
    ),
    502: err("`SHARE_REMOTE_UNREACHABLE`: the other server did not answer usably"),
  },
});

registry.registerPath({
  method: "get",
  path: "/sharing/remote/people",
  summary: "People on other servers the caller is paired with",
  tags,
  responses: {
    200: ok("One row per pairing, with its server", z.array(remotePersonSchema)),
    404: disabled,
  },
});
