/**
 * Invitation links and the caller's own admission requests (spec 2026-11-07 §6.2, §6.3), in
 * `routes/comparison.ts`: enveloped like the rest of that router, browser sessions only.
 */
import { z } from "zod";

import {
  inviteLinkRedeemBodySchema,
  inviteLinkResponseSchema,
  inviteRedeemResponseSchema,
  ownAdmissionsResponseSchema,
} from "../../../schemas/inviteLink";
import { registry } from "../registry";
import { errorContent } from "./shared";

const tags = ["Comparison"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
});
const gate = err(
  "`COMPARISON_TOKEN_REFUSED`: a personal access token; `COMPARISON_DISABLED`: beta switch off"
);
const throttled = err("Too many requests: 30 an hour for creating writes");

registry.registerPath({
  method: "post",
  path: "/comparison/invite-links",
  summary: "Create an invitation link for a friend on any server",
  description:
    "The link carries this server's identity and a single-use token in the URL fragment (`/freunde/einladung#…`), valid for 72 hours; the same 20-open cap as invitation codes applies.",
  tags,
  responses: {
    201: ok("The link", inviteLinkResponseSchema),
    409: err("`COMPARISON_FEDERATION_OFF`: this server is not connected to other servers"),
    403: gate,
    429: throttled,
  },
});

registry.registerPath({
  method: "post",
  path: "/comparison/invite-links/redeem",
  summary: "Accept an invitation link from a friend's server",
  description:
    "`claimed`: the friend's server is already connected, the request was sent. `awaitingAdmin`: this server's admin has to admit that server first. `awaitingPeerAdmin`: this admin did, the friend's admin has to. A user never pins a server, replaces a key or re-enables a suspended one.",
  tags,
  request: {
    body: { content: { "application/json": { schema: inviteLinkRedeemBodySchema } } },
  },
  responses: {
    200: ok("What happens next", inviteRedeemResponseSchema),
    400: err(
      "`FEDERATION_ADMISSION_INVALID`: damaged or oversized link; `COMPARISON_INVITE_INVALID`"
    ),
    403: gate,
    409: err(
      "`FEDERATION_ADMISSION_DISABLED`: federation is off here; `FEDERATION_ADMISSION_KEY_MISMATCH`; `FEDERATION_ADMISSION_SUSPENDED`"
    ),
    429: err("`FEDERATION_ADMISSION_FULL`: too many open requests, or the hourly write limit"),
    502: err("`FEDERATION_ADMISSION_UNREACHABLE`: that server's identity could not be read"),
  },
});

registry.registerPath({
  method: "get",
  path: "/comparison/admissions",
  summary: "The caller's own server-admission requests",
  tags,
  responses: {
    200: ok("Newest first, at most 50", ownAdmissionsResponseSchema),
    403: gate,
  },
});
