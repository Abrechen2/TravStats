/**
 * The trip-share wire contract (spec 2026-10-20 §4), served at `POST /api/v1/trip-share-peer`.
 * A protocol of its own beside the comparison protocol: its own route, its own schemas, the
 * shared crypto only. Nothing here imports the comparison contract, and
 * `services/sharing/federation/__tests__/separation.test.ts` fails if anything ever does.
 *
 * Phases built: F-S4a (`ping`), F-S4b (`invite-claim` / `invite-claim-reply`) and F-S4c (`offer`,
 * `offer-answer`, `entries`, each answered by an `ack`). Messages are strict objects
 * discriminated on `kind`; every one carries a `messageId` and a `sentAt` instant (ADR 0002: a `Z`
 * instant, never an offset-less datetime). A group message also carries `groupRef` (the group's
 * `federatedRef`) and `seq`, one sequence per (sending origin, group): the receiver accepts only
 * the next one (`streams.ts`).
 *
 * An entry carries the fact lists only (`services/sharing/federation/wire/shapes.ts`); there is
 * no private half on this wire at all (owner decision O1, 2026-10-20).
 */
import { z } from "./zod";
import { SHARE_ENTITIES, SHARE_TYPES } from "../services/sharing/shareTypes";
import { wireEntrySchema, wireTripSchema } from "../services/sharing/federation/wire/shapes";

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

/** Most entries an `entries` message may carry, and a trip may hold to be offered (spec §4). */
export const MAX_ENTRIES_PER_MESSAGE = 50;
export const MAX_ENTRIES_PER_TRIP = 500;

const seq = z.number().int().positive().max(2_147_483_647);
const groupHeader = { ...header, groupRef: uuid, seq };

/** Who is on the trip, as the home server names them (F5): needed for consent, nothing more. */
export const rosterEntrySchema = z.strictObject({
  displayName,
  origin: z.string().max(300),
});
/** How many entries of each type the trip holds — what the person is asked to accept. */
export const offerCountsSchema = z.strictObject(
  Object.fromEntries(
    SHARE_ENTITIES.map((e) => [
      SHARE_TYPES[e].countKey,
      z.number().int().min(0).max(MAX_ENTRIES_PER_TRIP),
    ])
  )
);

/**
 * The home server offers a trip to one person there (`to`, the channel that server minted for
 * them; `from`, the one minted here for the offering member). Trip facts, roster, counts — no
 * entries yet: a declined or unanswered offer copies nothing.
 */
export const offerSchema = z.strictObject({
  kind: z.literal("offer"),
  ...groupHeader,
  from: uuid,
  to: uuid,
  trip: wireTripSchema,
  roster: z.array(rosterEntrySchema).max(50),
  counts: offerCountsSchema,
});

/** The person's own answer on their own server — consent on the receiving side. */
export const offerAnswerSchema = z.strictObject({
  kind: z.literal("offer-answer"),
  ...groupHeader,
  /** The answering person's channel (minted by their server), then the offering member's. */
  from: uuid,
  to: uuid,
  answer: z.enum(["accept", "decline"]),
});

/** Entries of the offering member's trip (`from`), at most fifty per message. */
export const entriesSchema = z.strictObject({
  kind: z.literal("entries"),
  ...groupHeader,
  from: uuid,
  entries: z.array(wireEntrySchema).min(1).max(MAX_ENTRIES_PER_MESSAGE),
});

export const tripSharePacket = z.discriminatedUnion("kind", [
  tripPingSchema,
  inviteClaimSchema,
  offerSchema,
  offerAnswerSchema,
  entriesSchema,
]);

/** Read when a group message fails its schema, to answer `ack rejected: schema` instead of 403. */
export const groupHeaderSchema = z.object({
  kind: z.enum(["offer", "offer-answer", "entries"]),
  messageId: uuid,
  groupRef: uuid,
  seq,
});

/**
 * The answer to a group message. `gap` names the seq the receiver expects next; `not-member`
 * means no group, member or pairing here matches; `consent` that the person's consent with the
 * sender is not accepted here; `schema` names the first field that did not parse.
 */
export const ACK_REJECTIONS = ["gap", "not-member", "consent", "schema"] as const;
export type AckRejection = (typeof ACK_REJECTIONS)[number];
export const ackSchema = z.union([
  z.strictObject({ kind: z.literal("ack"), received: seq }),
  z.strictObject({
    kind: z.literal("ack"),
    rejected: z.enum(ACK_REJECTIONS),
    expected: seq.optional(),
    field: z.string().max(200).optional(),
  }),
]);
export type TripShareAck = z.infer<typeof ackSchema>;
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
    /**
     * A trip page's invitation offers its trip at once, inside the reply: the claimant's server
     * records the pairing and the offer together, so no offer can arrive before the pairing it
     * is addressed to exists. Null for a person-level invitation.
     */
    offer: offerSchema.nullable().optional(),
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
export type TripOffer = z.infer<typeof offerSchema>;
export type OfferAnswer = z.infer<typeof offerAnswerSchema>;
export type EntriesMessage = z.infer<typeof entriesSchema>;
export type GroupMessage = TripOffer | OfferAnswer | EntriesMessage;
