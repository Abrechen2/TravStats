/**
 * The leaderboard (`routes/comparison.ts`, spec 2026-10-16). Enveloped. Browser sessions only:
 * a personal access token is refused with `COMPARISON_TOKEN_REFUSED`.
 */
import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  boardBodySchema,
  boardViewSchema,
  claimBodySchema,
  consentRequestBodySchema,
  inviteResponseSchema,
  leaderboardResponseSchema,
  leaderboardScopeSchema,
  leaderboardSnapshotSchema,
  peopleResponseSchema,
  personViewSchema,
  scopeBodySchema,
} from "../../../schemas/comparison";

const tags = ["Comparison"];
const err = (description: string) => ({ description, content: errorContent });
const ok = (description: string, data: z.ZodTypeAny) => ({
  description,
  content: { "application/json": { schema: z.object({ success: z.literal(true), data }) } },
});
const json = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { "application/json": { schema } },
});
const gate = err(
  "`COMPARISON_TOKEN_REFUSED`: a personal access token; `COMPARISON_DISABLED`: beta switch off"
);
const idParam = z.object({ id: z.string().uuid() });
const notFound = err("`COMPARISON_NOT_FOUND`: no such comparison of the caller");
const throttled = err("Too many requests: 60 a minute per user, 30 an hour for creating writes");

registry.registerPath({
  method: "get",
  path: "/comparison/leaderboard",
  summary: "The caller's leaderboard: own totals and every consented friend's",
  description:
    "Same-instance friends are read under their consent; friends on other servers are pulled over the signed peer link, each bounded at 12 s. A row whose totals are unavailable carries a status instead of numbers: `notShared` (no accepted consent or an unreadable scope), `yearNotShared` (shared for `sharedYear` only), `withdrawn` (the friend ended it on their server), `unreachable` (their server did not answer in time or answered nonsense), `outdated` (their server speaks no snapshot version this one reads), `federationOff` (this server is not connected to other servers). Only `ok` rows carry a snapshot.",
  tags,
  request: {
    query: z.object({
      year: z
        .string()
        .optional()
        .describe("A year (1900-2200) or `all` (default) for the lifetime view"),
      board: z
        .string()
        .uuid()
        .optional()
        .describe("Restrict the rows to one of the caller's groups"),
    }),
  },
  responses: {
    200: ok("The rows, the caller first", leaderboardResponseSchema),
    400: err("Invalid year or group id"),
    403: gate,
    404: err("`COMPARISON_BOARD_NOT_FOUND`: no such group of the caller"),
    429: throttled,
  },
});

registry.registerPath({
  method: "post",
  path: "/comparison/preview",
  summary: "The caller's own totals under a consent scope — what the consent dialog shows",
  tags,
  request: { body: json(leaderboardScopeSchema) },
  responses: {
    200: ok("Exactly what that scope would share", leaderboardSnapshotSchema),
    400: err("Invalid scope"),
    403: gate,
    429: throttled,
  },
});

registry.registerPath({
  method: "get",
  path: "/comparison/people",
  summary:
    "Requests waiting for the caller, the people the caller compares with, and the caller's groups",
  tags,
  responses: {
    200: ok("People, requests and groups", peopleResponseSchema),
    403: gate,
    429: throttled,
  },
});

registry.registerPath({
  method: "post",
  path: "/comparison/requests",
  summary: "Offer the caller's totals to an account on this server and ask for theirs",
  description:
    "Limited to 30 requests an hour. Nothing is shared until the other side accepts: the caller's own consent stays `pending` until then. A declined or ended pair may be asked again.",
  tags,
  request: { body: json(consentRequestBodySchema) },
  responses: {
    201: ok("The person, as the caller now sees them", personViewSchema),
    400: err("`COMPARISON_SELF`: the caller's own username; or invalid input"),
    403: gate,
    404: err("`COMPARISON_USER_NOT_FOUND`: no active account of that name"),
    409: err("`COMPARISON_DUPLICATE`: the caller already asked or shares with that person"),
    429: throttled,
  },
});

for (const action of ["accept", "decline"] as const) {
  registry.registerPath({
    method: "post",
    path: `/comparison/consents/{id}/${action}`,
    summary:
      action === "accept" ? "Let the asking person see the caller's totals" : "Decline a request",
    tags,
    request:
      action === "accept" ? { params: idParam, body: json(scopeBodySchema) } : { params: idParam },
    responses: {
      200:
        action === "accept"
          ? ok("The person", personViewSchema)
          : ok("Declined", z.object({ declined: z.literal(true) })),
      400: err("Invalid id or scope"),
      403: gate,
      404: notFound,
      409: err("`COMPARISON_NOT_PENDING`: already answered"),
      429: throttled,
    },
  });
}

registry.registerPath({
  method: "put",
  path: "/comparison/consents/{id}",
  summary: "Change what an accepted consent shares",
  tags,
  request: { params: idParam, body: json(scopeBodySchema) },
  responses: {
    200: ok("The person", personViewSchema),
    400: err("Invalid id or scope"),
    403: gate,
    404: err("`COMPARISON_NOT_FOUND`: no accepted consent of the caller (or it just ended)"),
    429: throttled,
  },
});

registry.registerPath({
  method: "delete",
  path: "/comparison/people/{key}",
  summary: "End the comparison with a person, in both directions",
  description:
    "A friend on another server is removed here at once, even when their server does not answer; that server is told best-effort.",
  tags,
  request: {
    params: z.object({ key: z.string().describe("`local:<userId>` or `remote:<id>`") }),
  },
  responses: {
    200: ok("Ended", z.object({ ended: z.literal(true) })),
    400: err("Not a person key"),
    403: gate,
    404: notFound,
    429: throttled,
  },
});

registry.registerPath({
  method: "post",
  path: "/comparison/invites",
  summary: "Create a single-use invitation code for a person on another server (72 h)",
  tags,
  responses: {
    201: ok("The code to pass on", inviteResponseSchema),
    403: gate,
    409: err("`COMPARISON_FEDERATION_OFF`: this server is not connected to other servers"),
    429: err("`COMPARISON_INVITE_LIMIT`: 20 open invitations; or too many requests"),
  },
});

registry.registerPath({
  method: "post",
  path: "/comparison/invites/claim",
  summary: "Redeem an invitation from another server, sharing the caller's totals under a scope",
  tags,
  request: { body: json(claimBodySchema) },
  responses: {
    201: ok("The remote person", personViewSchema),
    400: err(
      "`COMPARISON_INVITE_INVALID`: malformed, unknown, used or expired code; or invalid scope"
    ),
    403: err(
      "`COMPARISON_PEER_UNKNOWN`: the admin has not connected that server; or the session gate"
    ),
    409: err(
      "`COMPARISON_PEER_OUTDATED`: that server needs an update; `COMPARISON_FEDERATION_OFF`; `COMPARISON_REMOTE_LIMIT`: 20 friends on other servers; `COMPARISON_DUPLICATE`: already a friend there"
    ),
    429: throttled,
    502: err("`COMPARISON_PEER_UNREACHABLE`: that server does not answer"),
  },
});

registry.registerPath({
  method: "post",
  path: "/comparison/boards",
  summary: "Create a group of people the caller can see",
  tags,
  request: { body: json(boardBodySchema) },
  responses: {
    201: ok("The group", boardViewSchema),
    400: err("`COMPARISON_BOARD_MEMBER_INVALID`: a member whose totals the caller cannot see"),
    403: gate,
    409: err("`COMPARISON_BOARD_LIMIT`: 50 groups"),
    429: throttled,
  },
});

registry.registerPath({
  method: "put",
  path: "/comparison/boards/{id}",
  summary: "Rename a group or change its members",
  tags,
  request: { params: idParam, body: json(boardBodySchema) },
  responses: {
    200: ok("The group", boardViewSchema),
    400: err("`COMPARISON_BOARD_MEMBER_INVALID`"),
    403: gate,
    404: err("`COMPARISON_BOARD_NOT_FOUND`"),
    429: throttled,
  },
});

registry.registerPath({
  method: "delete",
  path: "/comparison/boards/{id}",
  summary: "Delete a group",
  tags,
  request: { params: idParam },
  responses: {
    200: ok("Deleted", z.object({ deleted: z.literal(true) })),
    403: gate,
    404: err("`COMPARISON_BOARD_NOT_FOUND`"),
    429: throttled,
  },
});
