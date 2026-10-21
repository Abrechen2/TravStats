/**
 * Trip sharing across servers, phases F-S4b to F-S4e (`routes/sharingRemote.ts`, spec
 * `docs/superpowers/specs/2026-10-20-federated-trip-sharing-design.md`). Enveloped. The
 * server-to-server route `/trip-share-peer` is out of the spec, like `/comparison-peer`.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  acceptedOfferSchema,
  addRequestBodySchema,
  addRequestedSchema,
  rosterDecisionBodySchema,
  createdRemoteInviteSchema,
  receivedOfferSchema,
  remoteClaimBodySchema,
  remoteClaimResultSchema,
  remoteInviteSchema,
  remoteMemberSchema,
  remoteOfferBodySchema,
  remotePersonSchema,
  remoteStatusSchema,
  tripRemoteSharingSchema,
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
    200: ok(
      "This account redeemed this code before and the pairing exists: `alreadyConnected` is true; nothing was created",
      remoteClaimResultSchema
    ),
    201: ok("The person, now paired with the caller", remoteClaimResultSchema),
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

const tripParams = z.object({ tripId: z.string().uuid() });
const offerParams = z.object({ id: z.string().uuid() });
const peerFailures = {
  403: err("`SHARE_REMOTE_PEER_NOT_ADMITTED`: this server's admin has not admitted that server"),
  502: err("`SHARE_REMOTE_UNREACHABLE`: the other server did not answer usably"),
};

registry.registerPath({
  method: "get",
  path: "/sharing/remote/trips/{tripId}",
  summary: "A trip's people on other servers",
  description:
    "Every person on another server the trip was offered to, with their server and state (and what last went wrong), and the caller's paired people it can still be offered to. A trip that came from another server names that server and offers nobody: it is offered on from its home.",
  tags,
  request: { params: tripParams },
  responses: {
    200: ok("The trip's people on other servers", tripRemoteSharingSchema),
    404: err("`TRIP_NOT_FOUND`, or `SHARE_REMOTE_DISABLED`"),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/trips/{tripId}/offers",
  summary: "Offer a trip to a person on another server",
  description:
    "The offer carries the trip's facts, who is on it and how many entries it holds — no entry. The person accepts or declines on their own server; only an accepted offer copies anything, and then only the fact lists, never a private field. Offering again re-asks someone who has not answered or declined.",
  tags,
  request: {
    params: tripParams,
    body: { content: { "application/json": { schema: remoteOfferBodySchema } } },
  },
  responses: {
    201: ok("The person as a member of the trip, `invited`", remoteMemberSchema),
    404: err("`TRIP_NOT_FOUND`, `SHARE_REMOTE_PERSON_NOT_FOUND`, or `SHARE_REMOTE_DISABLED`"),
    409: err(
      "`SHARE_REMOTE_CONSENT_MISSING`, `SHARE_REMOTE_ALREADY_MEMBER`, `SHARE_REMOTE_NOT_HOME` (the trip came from another server, `extra.origin`), `SHARE_REMOTE_TRIP_TOO_LARGE` (more than 500 entries), `SHARE_REMOTE_PEER_DISABLED`, `SHARE_REMOTE_PEER_OUTDATED`, `SHARE_REMOTE_REFUSED` (the other server refused it, `extra.reason`)"
    ),
    ...peerFailures,
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/trips/{tripId}/invites",
  summary: "Issue an invitation code that also offers this trip",
  description:
    "Like `POST /sharing/remote/invites`, and redeeming it offers the trip at once; the person still accepts or declines it on their server.",
  tags,
  request: { params: tripParams },
  responses: {
    201: ok("The new invitation, with its code shown this once", createdRemoteInviteSchema),
    404: err("`TRIP_NOT_FOUND`, or `SHARE_REMOTE_DISABLED`"),
    409: err("`SHARE_REMOTE_NOT_HOME`: the trip came from another server"),
    429: err("`SHARE_REMOTE_INVITE_LIMIT`: 20 invitations are already open"),
  },
});

registry.registerPath({
  method: "get",
  path: "/sharing/remote/offers",
  summary: "Trips offered to the caller from other servers",
  description: "Waiting for an answer, newest first. Nothing of these trips is in the account yet.",
  tags,
  responses: { 200: ok("Open offers", z.array(receivedOfferSchema)), 404: disabled },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/offers/{id}/accept",
  summary: "Accept a trip offered from another server",
  description:
    "Creates the caller's own trip now; its entries follow from the other server, resolved against this server's catalogues, with each status derived here.",
  tags,
  request: { params: offerParams },
  responses: {
    200: ok("The caller's new trip", acceptedOfferSchema),
    404: err("`SHARE_REMOTE_OFFER_NOT_FOUND`, or `SHARE_REMOTE_DISABLED`"),
    409: err(
      "`SHARE_REMOTE_CONSENT_MISSING`, `SHARE_REMOTE_PEER_DISABLED`, `SHARE_REMOTE_REFUSED`"
    ),
    ...peerFailures,
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/offers/{id}/decline",
  summary: "Decline a trip offered from another server",
  description: "Nothing is copied. The other server is told; the offer stays open if it cannot be.",
  tags,
  request: { params: offerParams },
  responses: {
    200: ok("Declined", z.object({ declined: z.literal(true) })),
    404: err("`SHARE_REMOTE_OFFER_NOT_FOUND`, or `SHARE_REMOTE_DISABLED`"),
    409: err("`SHARE_REMOTE_PEER_DISABLED`, `SHARE_REMOTE_REFUSED`"),
    ...peerFailures,
  },
});

// The lifecycle (phase F-S4e).
const memberParams = z.object({ tripId: z.string().uuid(), memberId: z.string().uuid() });
const rosterParams = z.object({ tripId: z.string().uuid(), ref: z.string().uuid() });

registry.registerPath({
  method: "post",
  path: "/sharing/remote/people/{id}/withdraw",
  summary: "Withdraw the consent with a person on another server",
  description:
    "Immediate on this server: nothing more is sent to or taken from that person, their queued messages are deleted, and every trip the two share ends for them (`revoked`). Their server is told for each such trip, and a copy on the receiving side leaves its group; the copies stay their owners' trips. Leaving a single trip is `POST /sharing/trips/{tripId}/leave`, which tells the other servers too.",
  tags,
  request: { params: offerParams },
  responses: {
    200: ok("The person, with the consent `withdrawn`", remotePersonSchema),
    404: err("`SHARE_REMOTE_PERSON_NOT_FOUND`, or `SHARE_REMOTE_DISABLED`"),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/trips/{tripId}/roster/{ref}",
  summary: "Say yes or no to a person on another server who is on the trip",
  description:
    "A person who joined the trip after the caller — anyone but the caller's own pairing — reaches the caller's copy only after a yes. A yes takes effect from now on; changes made before it are not replayed. Taking an offered trip says yes to everyone the offer named.",
  tags,
  request: {
    params: rosterParams,
    body: { content: { "application/json": { schema: rosterDecisionBodySchema } } },
  },
  responses: {
    200: ok("The trip's people on other servers, with the answer", tripRemoteSharingSchema),
    404: err(
      "`TRIP_NOT_FOUND`, `SHARE_REMOTE_ROSTER_NOT_FOUND` (nobody to answer under that ref), or `SHARE_REMOTE_DISABLED`"
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/trips/{tripId}/reconfirm",
  summary: "Confirm the caller's held memberships of a trip again",
  description:
    "After a restore, an admin blocking a server or pinning a new key for it, the caller's memberships through that server wait (nothing is sent or taken). Confirming accepts the consent with each person again and resumes them; after a restore the home sends the trip's entries once more. The server must be admitted and verified again first.",
  tags,
  request: { params: tripParams },
  responses: {
    200: ok("The trip's people on other servers, resumed", tripRemoteSharingSchema),
    403: err("`SHARE_REMOTE_PEER_NOT_ADMITTED`: that server is not admitted (again) yet"),
    404: err("`TRIP_NOT_FOUND`, or `SHARE_REMOTE_DISABLED`"),
    409: err(
      "`SHARE_REMOTE_NOTHING_TO_CONFIRM`, `SHARE_REMOTE_CONSENT_MISSING` (the consent was withdrawn or declined, not just held)"
    ),
  },
});

registry.registerPath({
  method: "delete",
  path: "/sharing/remote/trips/{tripId}/members/{memberId}/parked",
  summary: "Dismiss the refused messages towards one member",
  description:
    "Messages the other server refused for good (or too large to send) are kept 30 days so the trip page can name them. Dismissing deletes them now; they are not sent again.",
  tags,
  request: { params: memberParams },
  responses: {
    200: ok("The trip's people on other servers", tripRemoteSharingSchema),
    404: err(
      "`TRIP_NOT_FOUND`, `SHARE_REMOTE_PERSON_NOT_FOUND` (no such member on the caller's page), or `SHARE_REMOTE_DISABLED`"
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/remote/trips/{tripId}/add-requests",
  summary: "Ask the trip's home server to offer it to someone else",
  description:
    "For a trip that came from another server: offers are made there only (F5). The request reaches the inbox of the person the caller is paired with on that server, who decides; nothing is offered by the request itself. Limited with the invitation endpoints, 30 an hour.",
  tags,
  request: {
    params: tripParams,
    body: { content: { "application/json": { schema: addRequestBodySchema } } },
  },
  responses: {
    201: ok("Asked", addRequestedSchema),
    404: err("`TRIP_NOT_FOUND`, or `SHARE_REMOTE_DISABLED`"),
    409: err(
      "`SHARE_REMOTE_IS_HOME` (offer it from here), `SHARE_REMOTE_NOT_MEMBER`, `SHARE_REMOTE_CONSENT_MISSING`, `SHARE_REMOTE_PEER_DISABLED`, `SHARE_REMOTE_REFUSED`"
    ),
    ...peerFailures,
  },
});
