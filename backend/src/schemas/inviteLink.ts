/**
 * The invitation link's payload (spec 2026-11-07 §6.3): what travels in the URL fragment, so it
 * never reaches a server log or a referrer. Bounded at 1 KB, and strict: a foreign or truncated
 * paste fails here, before any network call.
 */
import { z } from "zod";
import { origin } from "../services/federation/envelope";
import { leaderboardScopeSchema } from "./comparison";
import { connectionSwitchesSchema } from "./tripSharePeer";

export const INVITE_PAYLOAD_MAX_CHARS = 1024;
export const INVITE_LINK_KIND = "travstats-friend-invite";

export const inviteLinkPayloadSchema = z.strictObject({
  /** 2: carries the inviter's switches (display only; the server keeps its own copy). */
  v: z.union([z.literal(1), z.literal(2)]),
  kind: z.literal(INVITE_LINK_KIND),
  origin: origin.refine((o) => o !== "local"),
  /** The inviting server's raw 32-byte Ed25519 key, base64url. */
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  /** 32 random bytes as hex — the secret `lb-claim` already takes. */
  token: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
  switches: connectionSwitchesSchema.optional(),
});
export type InviteLinkPayload = z.infer<typeof inviteLinkPayloadSchema>;

export const inviteLinkRedeemBodySchema = z.strictObject({
  payload: z.string().min(1).max(INVITE_PAYLOAD_MAX_CHARS),
  /** Absent: every group and domain the redeemer has visible (the new-connection default). */
  scope: leaderboardScopeSchema.optional(),
  /** The redeemer's connection switches; absent: leaderboard only, as before. */
  switches: connectionSwitchesSchema.optional(),
});
export const inviteLinkCreateBodySchema = z.strictObject({
  /** What the inviter gives whoever redeems the link; absent: a link from before (leaderboard only). */
  switches: connectionSwitchesSchema.optional(),
});

export const inviteLinkResponseSchema = z.strictObject({
  url: z.string(),
  expiresAt: z.string().datetime(),
});
export const inviteRedeemResponseSchema = z.strictObject({
  status: z.enum(["claimed", "awaitingAdmin", "awaitingPeerAdmin", "awaitingInviter"]),
});
export const ownAdmissionSchema = z.strictObject({
  id: z.string().uuid(),
  origin: z.string(),
  fingerprint: z.string(),
  status: z.enum(["pending", "sent", "approved", "declined", "failed", "expired"]),
  failureReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export const ownAdmissionsResponseSchema = z.strictObject({
  admissions: z.array(ownAdmissionSchema),
});
