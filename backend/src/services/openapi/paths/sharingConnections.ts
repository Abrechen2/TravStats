/**
 * User connections across servers (`routes/sharingConnections.ts`, spec
 * `docs/superpowers/specs/2026-11-02-user-connections.md` §5). Enveloped. The server-to-server
 * messages (`connect-*`) travel on `/trip-share-peer`, which is out of the spec.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import { achievementsReplySchema } from "../../../schemas/tripSharePeer";
import {
  connectionAcceptBodySchema,
  connectionRequestBodySchema,
  connectionSchema,
  connectionSwitchesBodySchema,
} from "../../../schemas/sharingConnections";

const tags = ["Sharing"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
});
const jsonBody = (schema: z.ZodTypeAny) => ({
  required: true,
  content: { "application/json": { schema } },
});
const disabled = err("`SHARE_REMOTE_DISABLED`: cross-server sharing is off on this server");
const notFound = err("`SHARE_REMOTE_PERSON_NOT_FOUND`, or `SHARE_REMOTE_DISABLED`");
const wrongState = err(
  "`SHARE_REMOTE_CONNECTION_STATE` (the connection is not in a state this works in) or `SHARE_REMOTE_LEADERBOARD_UNAVAILABLE`"
);
const idParams = z.object({ id: z.string().uuid().describe("The connection's id") });

registry.registerPath({
  method: "get",
  path: "/sharing/connections",
  summary: "The caller's connections with people on other servers",
  description:
    "One row per person, with its state and both sides' switches. `theirs` of a `pending_in` row is what the asker chose to give, so the confirm dialog can show it. Pairings made before connections existed are `reconfirm`: the trips already shared keep working, nothing new starts until both sides confirm.",
  tags,
  responses: { 200: ok("The connections", z.array(connectionSchema)), 404: disabled },
});

registry.registerPath({
  method: "post",
  path: "/sharing/connections",
  summary: "Ask a person on a connected server to connect",
  description:
    "The answer never says whether the person exists or is findable: the request is sent and waits (`pending_out`). A person who declined blocks the same person's requests for 30 days, silently. Limited to 30 an hour per user.",
  tags,
  request: { body: jsonBody(connectionRequestBodySchema) },
  responses: {
    201: ok("The connection, `pending_out`", connectionSchema),
    404: disabled,
    409: err(
      "`SHARE_REMOTE_CONNECTION_EXISTS`, `SHARE_REMOTE_PEER_DISABLED` or `SHARE_REMOTE_PEER_OUTDATED`"
    ),
    429: err("`RATE_LIMITED`"),
    403: err("`SHARE_REMOTE_PEER_NOT_ADMITTED`"),
    502: err("`SHARE_REMOTE_UNREACHABLE`"),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/connections/{id}/accept",
  summary: "Confirm a request with the switches the caller chose",
  description:
    "For a `pending_in` request: becomes `active`. For a `reconfirm` pairing: asks the other side to confirm it again (`pending_out`).",
  tags,
  request: { params: idParams, body: jsonBody(connectionAcceptBodySchema) },
  responses: {
    200: ok("The connection", connectionSchema),
    404: notFound,
    409: wrongState,
    502: err(
      "`SHARE_REMOTE_UNREACHABLE`: the other server did not get the answer; nothing changed"
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/sharing/connections/{id}/decline",
  summary: "Decline a request",
  description:
    "Blocks the same person's requests for 30 days (silently). The other server is told once.",
  tags,
  request: { params: idParams },
  responses: {
    200: ok("The connection, `declined`", connectionSchema),
    404: notFound,
    409: wrongState,
  },
});

registry.registerPath({
  method: "put",
  path: "/sharing/connections/{id}/switches",
  summary: "Change what the caller gives this person",
  description:
    "Takes effect on this server at once; the other server is told after (best effort). Active connections only.",
  tags,
  request: { params: idParams, body: jsonBody(connectionSwitchesBodySchema) },
  responses: { 200: ok("The connection", connectionSchema), 404: notFound, 409: wrongState },
});

registry.registerPath({
  method: "delete",
  path: "/sharing/connections/{id}",
  summary: "End a connection, or take back a request not yet answered",
  description:
    "Statistics, leaderboard, consents, memberships and open trip offers stop on this server at once; trips already shared keep their linked copies. The other server is told. A `pending_in` request is declined instead.",
  tags,
  request: { params: idParams },
  responses: {
    200: ok("The connection, `revoked`", connectionSchema),
    404: notFound,
    409: wrongState,
  },
});

registry.registerPath({
  method: "get",
  path: "/sharing/connections/{id}/achievements",
  summary: "The achievements a connected person shows the caller",
  description:
    "Needs an `active` connection whose other side has switched `achievements` on. Answers the earned badges (the set that person's own achievements page lists, with their domain visibility applied) and the totals - no progress figures and no records. `unlockedAt` is the first time the requirement was met, or null. Asks the other server (feature `achievements` in the ping); limited to 120 an hour per user.",
  tags,
  request: { params: idParams },
  responses: {
    200: ok(
      "Totals and earned badges",
      achievementsReplySchema.options[1].omit({ kind: true, status: true })
    ),
    403: err(
      "`SHARE_REMOTE_ACHIEVEMENTS_NOT_SHARED` (one answer for every cause), or `SHARE_REMOTE_PEER_NOT_ADMITTED`"
    ),
    404: notFound,
    409: err(
      "`SHARE_REMOTE_CONNECTION_REQUIRED` (not active), `SHARE_REMOTE_PEER_DISABLED` or `SHARE_REMOTE_PEER_OUTDATED`"
    ),
    502: err("`SHARE_REMOTE_UNREACHABLE`"),
  },
});
