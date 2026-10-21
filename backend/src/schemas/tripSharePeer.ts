/**
 * The trip-share wire contract (spec 2026-10-20 §4), served at `POST /api/v1/trip-share-peer`.
 * A protocol of its own beside the comparison protocol: its own route, its own schemas, the
 * shared crypto only. Nothing here imports the comparison contract, and
 * `services/sharing/federation/__tests__/separation.test.ts` fails if anything ever does.
 *
 * Phases built: F-S4a (`ping`), F-S4b (`invite-claim` / `invite-claim-reply`), F-S4c (`offer`,
 * `offer-answer`, `entries`) and F-S4d (`fact-update`, `entry-create`, `entry-removed`), each group
 * message answered by an `ack`. Messages are strict objects
 * discriminated on `kind`; every one carries a `messageId` and a `sentAt` instant (ADR 0002: a `Z`
 * instant, never an offset-less datetime). A group message also carries `groupRef` (the group's
 * `federatedRef`) and `seq`, one sequence per (sending origin, group): the receiver accepts only
 * the next one (`streams.ts`).
 *
 * An entry carries the fact lists only (`services/sharing/federation/wire/shapes.ts`); there is
 * no private half on this wire at all (owner decision O1, 2026-10-20).
 */
import { z } from "./zod";
import { origin as peerOrigin } from "../services/federation/envelope";
import { SHARE_ENTITIES, SHARE_TYPES } from "../services/sharing/shareTypes";
import {
  ENTRY_SHAPES,
  wireEntrySchema,
  wireTripSchema,
} from "../services/sharing/federation/wire/shapes";

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

/**
 * Who is on the trip, as the home server names them (F5): needed for consent, nothing more. `ref`
 * is the person's id in this group's roster, minted by the home (F-S4e) — random per group, never
 * an account id — so a member can say yes to one person and a change can name its author.
 */
export const rosterEntrySchema = z.strictObject({
  ref: uuid,
  displayName,
  origin: z.string().max(300),
});
/** Most people a roster names. */
export const MAX_ROSTER = 100;
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
  /** The roster refs of the offering member (`from`) and of the person offered to (`to`). */
  self: uuid,
  you: uuid,
  trip: wireTripSchema,
  roster: z.array(rosterEntrySchema).max(MAX_ROSTER),
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

/**
 * Entries of the offering member's trip (`from`), at most fifty per message. A resend after a
 * restore (F-S4e) names, per entry someone else brought in, that person's roster ref
 * (`authors`): the receiver copies it only for a person who said yes to them.
 */
export const entriesSchema = z.strictObject({
  kind: z.literal("entries"),
  ...groupHeader,
  from: uuid,
  entries: z.array(wireEntrySchema).min(1).max(MAX_ENTRIES_PER_MESSAGE),
  authors: z
    .array(z.strictObject({ shareKey: uuid, ref: uuid }))
    .max(MAX_ENTRIES_PER_MESSAGE)
    .optional(),
});

/**
 * Who made a change (F-S4d), as the sending server CLAIMS it. `origin` is absent when the change
 * was made on the sending server itself; a home relaying a spoke's change names the spoke. The
 * receiver honours the claim only from the group's home and only for an origin it knows as a
 * member of the group (`inbound.ts` `authorOf`); otherwise the author is the sending pairing.
 */
export const changeActorSchema = z.strictObject({
  displayName,
  // The canonical form only (`https://host`, no path, port or trailing slash): a claim is
  // compared with stored origins byte for byte, so a variant spelling is refused, not matched.
  origin: peerOrigin.refine((v) => v !== "local", "not a server origin").optional(),
  /**
   * The author's roster ref (F-S4e), set by the home: a spoke names a relayed author by its
   * roster, never by the claimed name, and applies the change only for a member who said yes to
   * that person. A ref the spoke does not know is not applied.
   */
  ref: uuid.optional(),
});

/**
 * The propagation messages (F-S4d) are between two pairings: `from` is the channel the receiving
 * server minted for the sending side's member, `to` the one minted for its own person — the same
 * two names as `offer`.
 */
const pairingHeader = { ...groupHeader, from: uuid, to: uuid, actor: changeActorSchema };
const entity = z.enum(SHARE_ENTITIES);

/** Most facts one `fact-update` may change. */
export const MAX_CHANGES_PER_UPDATE = 100;

/**
 * One fact of one entry changed (F6): per fact the value the sender held BEFORE and the one it
 * holds now, each in the field's wire form (`ENTRY_SHAPES[entity][field]`). The receiver writes
 * a fact only where its copy still holds `before`; a reference is compared by its natural key
 * (UN/LOCODE, IMO, …), never by either server's catalogue id.
 */
export const factUpdateSchema = z
  .strictObject({
    kind: z.literal("fact-update"),
    ...pairingHeader,
    entity,
    shareKey: uuid,
    changes: z
      .array(z.strictObject({ field: z.string().max(80), before: z.json(), after: z.json() }))
      .min(1)
      .max(MAX_CHANGES_PER_UPDATE),
  })
  .superRefine((message, ctx) => {
    const shape = ENTRY_SHAPES[message.entity];
    message.changes.forEach((change, i) => {
      const codec = Object.hasOwn(shape, change.field) ? shape[change.field] : undefined;
      if (!codec) {
        ctx.addIssue({ code: "custom", path: ["changes", i, "field"], message: "unknown fact" });
        return;
      }
      for (const side of ["before", "after"] as const) {
        if (!codec.wire.safeParse(change[side]).success)
          ctx.addIssue({ code: "custom", path: ["changes", i, side], message: "not this fact" });
      }
    });
  });

/** One entry added to the shared trip (or moved into it), exactly as in `entries`. */
export const entryCreateSchema = z.strictObject({
  kind: z.literal("entry-create"),
  ...pairingHeader,
  entry: wireEntrySchema,
});

/** An entry was deleted or moved out of the trip: a notice only, a copy is never removed. */
export const entryRemovedSchema = z.strictObject({
  kind: z.literal("entry-removed"),
  ...pairingHeader,
  entity,
  shareKey: uuid,
  reason: z.enum(["deleted", "movedOut"]),
});

/**
 * The roster (F-S4e), home → each spoke member, whenever someone joins or leaves: who is on the
 * trip, with `self` (the home member of this pairing) and `you` (the person it is sent to). The
 * stream's order makes the latest one true; a spoke keeps names of people who left.
 */
export const rosterSchema = z.strictObject({
  kind: z.literal("roster"),
  ...groupHeader,
  from: uuid,
  to: uuid,
  self: uuid,
  you: uuid,
  members: z.array(rosterEntrySchema).max(MAX_ROSTER),
});

/** A member left the trip (F-S4e); their copy stays theirs (decision 5). Either direction. */
export const leaveSchema = z.strictObject({
  kind: z.literal("leave"),
  ...groupHeader,
  from: uuid,
  to: uuid,
});

/**
 * The consent of this pairing was withdrawn (F-S4e): the sender has stopped at once, the
 * receiver stops too, and a copy on the spoke leaves its group. Sent once per group the pairing
 * shares; it ends the pairing's consent as a whole.
 */
export const revokeSchema = z.strictObject({
  kind: z.literal("revoke"),
  ...groupHeader,
  from: uuid,
  to: uuid,
});

/**
 * A spoke member asks the home to offer the trip to someone else (F5, F-S4e). A request only:
 * offers stay with the home, whose member decides — by the person named here, nothing more.
 */
export const addRequestSchema = z.strictObject({
  kind: z.literal("add-request"),
  ...groupHeader,
  from: uuid,
  to: uuid,
  person: z.strictObject({
    displayName,
    origin: peerOrigin.refine((v) => v !== "local", "not a server origin").optional(),
  }),
  note: z.string().trim().max(500).optional(),
});

export const tripSharePacket = z.discriminatedUnion("kind", [
  tripPingSchema,
  inviteClaimSchema,
  offerSchema,
  offerAnswerSchema,
  entriesSchema,
  factUpdateSchema,
  entryCreateSchema,
  entryRemovedSchema,
  rosterSchema,
  leaveSchema,
  revokeSchema,
  addRequestSchema,
]);

/** The group messages; a header of one of these is answered `schema` when the body fails. */
export const GROUP_KINDS = [
  "offer",
  "offer-answer",
  "entries",
  "fact-update",
  "entry-create",
  "entry-removed",
  "roster",
  "leave",
  "revoke",
  "add-request",
] as const;

/**
 * The group messages that leave through the outbox (F-S4d); the offer and its answer, a
 * person's own click, are sent directly. Also the CHECK `trip_share_outbox_kind_check`;
 * `shareVocabulary.test.ts` holds the two together.
 */
export const OUTBOX_KINDS = [
  "entries",
  "fact-update",
  "entry-create",
  "entry-removed",
  // F-S4e: the roster, and the end of a membership — told even after the member stopped
  // receiving anything else.
  "roster",
  "leave",
  "revoke",
] as const satisfies readonly (typeof GROUP_KINDS)[number][];
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/** Read when a group message fails its schema, to answer `ack rejected: schema` instead of 403. */
export const groupHeaderSchema = z.object({
  kind: z.enum(GROUP_KINDS),
  messageId: uuid,
  groupRef: uuid,
  seq,
});

/**
 * The answer to a group message. `gap` names the seq the receiver expects next; `not-member`
 * means no group, member or pairing here matches; `consent` that the person's consent with the
 * sender is not accepted here; `schema` names the first field that did not parse; `error` that
 * the receiver failed to apply it for a reason of its own (its database, its code) — nothing was
 * written, and the sender retries it; `suspended` that the membership is held here (a restore,
 * a re-pinned key, a blocked server) until its person confirms it again — retried, not parked.
 */
export const ACK_REJECTIONS = [
  "gap",
  "not-member",
  "consent",
  "schema",
  "error",
  "suspended",
] as const;
export type AckRejection = (typeof ACK_REJECTIONS)[number];
/**
 * A `fact-update` answered with the facts that were NOT written because the receiver's copy had
 * moved since (F6): per fact, the value it holds, in wire form — so the sender's person sees both
 * values too, and nothing was swapped on either side.
 */
export const ackConflictSchema = z.strictObject({ field: z.string().max(80), held: z.json() });
export const ackSchema = z.union([
  z.strictObject({
    kind: z.literal("ack"),
    received: seq,
    conflicts: z.array(ackConflictSchema).max(MAX_CHANGES_PER_UPDATE).optional(),
  }),
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
export type FactUpdateMessage = z.infer<typeof factUpdateSchema>;
export type EntryCreateMessage = z.infer<typeof entryCreateSchema>;
export type EntryRemovedMessage = z.infer<typeof entryRemovedSchema>;
export type ChangeActor = z.infer<typeof changeActorSchema>;
export type AckConflict = z.infer<typeof ackConflictSchema>;
export type PropagationMessage = FactUpdateMessage | EntryCreateMessage | EntryRemovedMessage;
export type RosterMessage = z.infer<typeof rosterSchema>;
export type RosterEntry = z.infer<typeof rosterEntrySchema>;
export type LeaveMessage = z.infer<typeof leaveSchema>;
export type RevokeMessage = z.infer<typeof revokeSchema>;
export type AddRequestMessage = z.infer<typeof addRequestSchema>;
export type LifecycleMessage = RosterMessage | LeaveMessage | RevokeMessage | AddRequestMessage;
export type GroupMessage =
  TripOffer | OfferAnswer | EntriesMessage | PropagationMessage | LifecycleMessage;
