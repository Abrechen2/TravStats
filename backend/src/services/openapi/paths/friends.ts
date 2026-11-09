/**
 * Friends (`routes/friends.ts`, spec 2026-11-08 §11.4): a friend is one connection, local or
 * remote. Enveloped. `/sharing/connections` and its Companion contract are unchanged.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  friendAcceptBodySchema,
  friendCreateBodySchema,
  friendDeclinedSchema,
  friendRemovedSchema,
  friendPlansSchema,
  friendRequestedSchema,
  friendSchema,
  friendScopeBodySchema,
  friendsListSchema,
  friendSwitchesBodySchema,
  friendTripsSchema,
} from "../../../schemas/friends";

const tags = ["Friends"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
});
const jsonBody = (schema: z.ZodTypeAny) => ({
  required: true,
  content: { "application/json": { schema } },
});
const params = z.object({ key: z.string().describe("`local:<userId>` or `remote:<id>`") });
const notFound = err("`FRIENDS_NOT_FOUND`");
const wrongState = err(
  "`FRIENDS_CONNECTION_STATE` (a stale answer, or not in a state this works in), `FRIENDS_SCOPE_UNAVAILABLE`, or a `SHARE_REMOTE_*` refusal of the cross-server protocol"
);

registry.registerPath({
  method: "get",
  path: "/friends",
  summary: "The caller's friends, open requests and own server admissions",
  description:
    "One list for people on this server and on connected servers. A request is a friend with `state: pending_in`; `theirs` is what the asker chose to give. `comparisonOnly` marks a leaderboard pairing with a server that predates connections.",
  tags,
  responses: { 200: ok("The friends", friendsListSchema) },
});

registry.registerPath({
  method: "post",
  path: "/friends",
  summary: "Ask a person to be a friend",
  description:
    "`origin: null` asks a person on this server. The answer never says whether the person exists, was findable, or whether a request was dropped (a decline blocks the asker for 30 days, silently). Both asking each other makes the second ask the answer. Limited to 30 an hour.",
  tags,
  request: { body: jsonBody(friendCreateBodySchema) },
  responses: {
    201: ok("Requested", friendRequestedSchema),
    409: err(
      "`FRIENDS_CONNECTION_EXISTS`, or a `SHARE_REMOTE_*` refusal (`SHARE_REMOTE_PEER_OUTDATED` when the server predates connections)"
    ),
    429: err("`RATE_LIMITED`"),
  },
});

registry.registerPath({
  method: "post",
  path: "/friends/{key}/accept",
  summary: "Accept a request with the switches the caller gives",
  tags,
  request: { params, body: jsonBody(friendAcceptBodySchema) },
  responses: { 200: ok("The friend, now active", friendSchema), 404: notFound, 409: wrongState },
});

registry.registerPath({
  method: "post",
  path: "/friends/{key}/decline",
  summary: "Decline a request",
  tags,
  request: { params },
  responses: { 200: ok("Declined", friendDeclinedSchema), 404: notFound, 409: wrongState },
});

registry.registerPath({
  method: "put",
  path: "/friends/{key}/switches",
  summary: "Change what the caller gives this friend",
  description:
    "Changes the caller's side only. A switch update never touches the stored comparison scope: switching the leaderboard off and on restores it.",
  tags,
  request: { params, body: jsonBody(friendSwitchesBodySchema) },
  responses: { 200: ok("The friend", friendSchema), 404: notFound, 409: wrongState },
});

registry.registerPath({
  method: "put",
  path: "/friends/{key}/scope",
  summary: "Store the comparison scope behind the leaderboard switch",
  description:
    "Does not change the switch. A missing or damaged scope reads as not shared (fails closed).",
  tags,
  request: { params, body: jsonBody(friendScopeBodySchema) },
  responses: { 200: ok("The friend", friendSchema), 404: notFound, 409: wrongState },
});

registry.registerPath({
  method: "delete",
  path: "/friends/{key}",
  summary: "Remove a friend, or take back a request",
  description:
    "Every switch goes off at once. Linked copies already delivered stay open as the friend's own trips; plans already joined stay readable.",
  tags,
  request: { params },
  responses: { 200: ok("Removed", friendRemovedSchema), 404: notFound, 409: wrongState },
});

registry.registerPath({
  method: "get",
  path: "/friends/{key}/trips",
  summary: "Trips shared with this friend, in both directions",
  tags,
  request: { params },
  responses: { 200: ok("The trips", friendTripsSchema), 404: notFound },
});

registry.registerPath({
  method: "get",
  path: "/friends/{key}/plans",
  summary: "Plans both are members of",
  tags,
  request: { params },
  responses: { 200: ok("The plans", friendPlansSchema), 404: notFound },
});
