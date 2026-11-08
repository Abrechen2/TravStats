import { z } from "./zod";
import { origin as peerOrigin } from "../services/federation/envelope";
import { leaderboardScopeSchema } from "./comparison";
import { connectionSwitchesSchema } from "./tripSharePeer";

/**
 * `/api/v1/friends` (spec 2026-11-08 §11.4): a friend IS a connection, local or remote. Enveloped.
 * `switches` are directional — `mine` is what the caller gives, `theirs` what the other side gives
 * (for a request still waiting, what the asker chose).
 */
export { connectionSwitchesSchema };

const uuid = z.string().uuid();
export const friendKeySchema = z
  .string()
  .regex(/^(local|remote):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const friendCreateBodySchema = z.strictObject({
  username: z.string().trim().min(1).max(80),
  /** null: a person on this server. */
  origin: peerOrigin.nullable(),
  switches: connectionSwitchesSchema,
});
export const friendAcceptBodySchema = z.strictObject({ switches: connectionSwitchesSchema });
export const friendSwitchesBodySchema = friendAcceptBodySchema;
export const friendScopeBodySchema = z.strictObject({ scope: leaderboardScopeSchema });

export const FRIEND_STATES = [
  "pending_out",
  "pending_in",
  "active",
  "declined",
  "revoked",
  "reconfirm",
] as const;
const instant = z.iso.datetime();

export const friendSchema = z.strictObject({
  key: friendKeySchema.describe(
    "`local:<userId>`, or `remote:<id>`. For a remote friend with a leaderboard pairing the id is the pairing's (the same key `GET /comparison/compare` answers with); a connection without one is keyed by its own id. Both resolve."
  ),
  kind: z.enum(["local", "remote"]),
  connectionId: uuid.nullable().describe("The `/sharing/connections` id of a remote connection"),
  username: z.string(),
  displayName: z.string(),
  origin: z.string().nullable().describe("The other server; null for a person on this server"),
  state: z.enum(FRIEND_STATES),
  comparisonOnly: z
    .boolean()
    .describe(
      "A leaderboard pairing without a connection (the other server predates connections): only the comparison works"
    ),
  mine: connectionSwitchesSchema,
  theirs: connectionSwitchesSchema,
  scope: leaderboardScopeSchema
    .nullable()
    .describe("The comparison scope behind the caller's leaderboard switch; null: none stored"),
  olderServer: z
    .boolean()
    .describe("Same as `comparisonOnly`: the other server predates connections (spec §11.7)"),
  switches: connectionSwitchesSchema
    .nullable()
    .describe("Requests only: what the asker offers (the same as `theirs`); null for a friend"),
  proposed: connectionSwitchesSchema
    .nullable()
    .describe(
      "A request that came over the caller's own link: the switches the caller chose when creating it, the confirm dialog's default"
    ),
  viaLink: z
    .boolean()
    .describe("The request came from an invitation link the caller created (spec §11.8)"),
  fingerprint: z
    .string()
    .nullable()
    .describe("Of the other server's key, for a request that came in over a link"),
  requestedAt: instant.nullable(),
  confirmedAt: instant.nullable(),
});

export const friendAdmissionSchema = z.strictObject({
  id: uuid,
  origin: z.string(),
  fingerprint: z.string(),
  status: z.enum(["pending", "sent", "approved", "declined", "failed", "expired"]),
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export const friendsListSchema = z.strictObject({
  friends: z.array(friendSchema),
  requests: z.array(friendSchema),
  admissions: z.array(friendAdmissionSchema),
  federationAvailable: z
    .boolean()
    .describe("Whether this server can reach people on other servers right now"),
});

export const friendRequestedSchema = z.strictObject({
  requested: z.literal(true),
});

export const friendTripSchema = z.strictObject({
  id: uuid.describe("The trip's id where it lives (the shared trip, or the friend's)"),
  title: z.string(),
  // Plain text on purpose: the trip's own dates, as the trip endpoints send them.
  startDate: z.string().nullable().describe("ISO 8601, the trip's start"),
  endDate: z.string().nullable().describe("ISO 8601, the trip's end"),
  copyState: z
    .enum(["linked", "pending", "declined", "removed"])
    .describe("`linked`: the linked copy exists; `pending`: an offer waits for an answer"),
  localTripId: uuid.nullable().describe("The trip to open on this server, if there is one"),
});
export const friendTripsSchema = z.strictObject({
  toThem: z.array(friendTripSchema),
  fromThem: z.array(friendTripSchema),
});

export const friendPlanSchema = z.strictObject({
  id: uuid.describe("The plan's trip id"),
  title: z.string(),
  // Plain text on purpose: the trip's own dates, as the trip endpoints send them.
  startDate: z.string().nullable().describe("ISO 8601, the trip's start"),
  endDate: z.string().nullable().describe("ISO 8601, the trip's end"),
  owner: z.enum(["me", "them"]),
  role: z.string(),
});
export const friendPlansSchema = z.strictObject({ plans: z.array(friendPlanSchema) });
export const friendDeclinedSchema = z.strictObject({ declined: z.literal(true) });
export const friendRemovedSchema = z.strictObject({ removed: z.literal(true) });
