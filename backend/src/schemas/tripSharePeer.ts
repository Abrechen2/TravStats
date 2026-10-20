/**
 * The trip-share wire contract (spec 2026-10-20 §4), served at `POST /api/v1/trip-share-peer`.
 * A protocol of its own beside the comparison protocol: its own route, its own schemas, the
 * shared crypto only. Nothing here imports the comparison contract, and
 * `services/sharing/federation/__tests__/separation.test.ts` fails if anything ever does.
 *
 * Phases built: F-S4a (`ping`) and F-S4b (`invite-claim` / `invite-claim-reply`). Messages are
 * strict objects discriminated on `kind`; every one carries a `messageId` and a `sentAt` instant
 * (ADR 0002: a `Z` instant, never an offset-less datetime). `groupRef` and `seq` arrive with the
 * group messages of F-S4c.
 */
import { z } from "./zod";

/** The envelope purpose this protocol signs and accepts (envelope version 2). */
export const TRIP_SHARE_PURPOSE = "trip-share/1" as const;
/** Trip-share protocol versions this server serves; the ping answers with them. */
export const TRIP_SHARE_VERSIONS = [1] as const;

const uuid = z.string().uuid();
/** A UTC instant with `Z`; an offset-less or offset datetime is refused (ADR 0002 D3). */
const instant = z.iso.datetime();
const header = { messageId: uuid, sentAt: instant };
export const inviteSecretSchema = z.string().regex(/^[a-f0-9]{64}$/);
const username = z.string().trim().min(1).max(80);
const displayName = z.string().trim().min(1).max(160);

export const tripPingSchema = z.strictObject({ kind: z.literal("ping"), ...header });

/**
 * The claimant's server redeems a code against the inviting server. `channel` is random
 * entropy the claimant's server minted for its user in this pairing — never an account id.
 * The names are that server's word, under its signature.
 */
export const inviteClaimSchema = z.strictObject({
  kind: z.literal("invite-claim"),
  ...header,
  code: inviteSecretSchema,
  channel: uuid,
  username,
  displayName,
});

export const tripSharePacket = z.discriminatedUnion("kind", [tripPingSchema, inviteClaimSchema]);
export type TripSharePacket = z.infer<typeof tripSharePacket>;

/** Not strict: a newer server may say more, and only `tripShare` is read. */
export const tripPingReplySchema = z.object({
  tripShare: z.array(z.number().int().positive()).max(8),
});

/**
 * Why a code was not redeemed. The secret is 256 bits, so naming "used" or "expired" for a code
 * the claimant holds tells nobody anything about other codes; it lets the claimant's screen say
 * which instead of one shrug. An inactive issuer reads as `unknown`.
 */
export const INVITE_REFUSALS = ["unknown", "used", "expired", "duplicate"] as const;
export type InviteRefusal = (typeof INVITE_REFUSALS)[number];

export const inviteClaimReplySchema = z.discriminatedUnion("accepted", [
  z.strictObject({
    kind: z.literal("invite-claim-reply"),
    accepted: z.literal(true),
    /** Random entropy the inviting server minted for its user in this pairing. */
    channel: uuid,
    username,
    displayName,
    /** The group a trip page's invitation is for (F-S4c); a person-level invitation sends null. */
    federatedRef: uuid.nullable(),
  }),
  z.strictObject({
    kind: z.literal("invite-claim-reply"),
    accepted: z.literal(false),
    reason: z.enum(INVITE_REFUSALS),
  }),
]);

export type TripPing = z.infer<typeof tripPingSchema>;
export type InviteClaim = z.infer<typeof inviteClaimSchema>;
export type InviteClaimReply = z.infer<typeof inviteClaimReplySchema>;
