/**
 * `/api/v1/sharing/remote/*` — the user's side of trip sharing across servers (spec 2026-10-20,
 * phase F-S4b): request bodies and the response shapes the OpenAPI spec publishes.
 */
import { z } from "./zod";
import { CONSENT_STATUSES } from "./sharing";
import { SHARE_ENTITIES, SHARE_TYPES } from "../services/sharing/shareTypes";

const instant = z.iso.datetime();

/** The pasted code, as the user pasted it; `parseTripInviteCode` decides what it is. */
export const remoteClaimBodySchema = z.strictObject({ code: z.string().trim().min(1).max(400) });
export const remoteInviteIdSchema = z.string().uuid();

export const remoteStatusSchema = z.strictObject({
  available: z.boolean(),
  /** Why not, when not: the beta switch, the admin's switch, or no server identity. */
  reason: z.enum(["beta-off", "switch-off", "no-identity"]).nullable(),
  /** This server's origin while available — the part before `#` in the codes it issues. */
  origin: z.string().nullable(),
});
export const remoteInviteSchema = z.strictObject({
  id: z.string().uuid(),
  createdAt: instant,
  expiresAt: instant,
  tripId: z.string().uuid().nullable().describe("The trip a trip page's invitation offers"),
});
export const createdRemoteInviteSchema = remoteInviteSchema.extend({
  code: z.string().describe("`<origin>#trip:<64 hex>` — shown once; only its hash is stored"),
});
export const remotePersonSchema = z.strictObject({
  id: z.string().uuid(),
  origin: z.string().describe("The server this person's account is on"),
  username: z.string(),
  displayName: z.string(),
  consent: z.enum(CONSENT_STATUSES),
  createdAt: instant,
});

/**
 * A remote member's state (spec 2026-10-20 F3; `declined` added in F-S4c, so an offer the person
 * turned down reads as such instead of as a member who left). Also the CHECK
 * `trip_share_remote_members_state_check`; `shareVocabulary.test.ts` holds the two together.
 */
export const REMOTE_MEMBER_STATES = [
  "invited",
  "active",
  "declined",
  "unreachable",
  "suspended",
  "left",
  "revoked",
] as const;
export const remoteMemberStateSchema = z.enum(REMOTE_MEMBER_STATES);
export type RemoteMemberState = z.infer<typeof remoteMemberStateSchema>;

/** F-S4c: offering a trip from its page, and answering an offer. */
export const remoteTripIdSchema = z.string().uuid();
export const remoteOfferIdSchema = z.string().uuid();
export const remoteOfferBodySchema = z.strictObject({ remoteId: z.string().uuid() });

export const remoteMemberSchema = z.strictObject({
  id: z.string().uuid(),
  remoteId: z.string().uuid(),
  displayName: z.string(),
  username: z.string(),
  origin: z.string(),
  state: remoteMemberStateSchema,
  stateReason: z
    .string()
    .nullable()
    .describe(
      "Why the state is what it is (`off`, `peer-blocked`, `unreachable`, `restore`, `entries-too-large`); null when fine"
    ),
  stateSince: instant,
  delivery: z
    .strictObject({
      state: z.enum(["delivered", "pending", "retrying", "unreachable", "rejected"]),
      stateSince: instant
        .nullable()
        .describe("`retrying`/`unreachable`: failing since; `rejected`: when it was refused"),
      reason: z
        .string()
        .nullable()
        .describe(
          "`retrying`: the failure kind (`unreachable`, `remote-refused`, …; `local-error` for an error of this server, `remote-error` for one the other server met applying it); `rejected`: `schema`, `not-member`, `consent` or `too-large`"
        ),
      field: z.string().nullable().describe("`rejected` for `schema`: what did not parse"),
      label: z.string().nullable().describe("`rejected`: the entry the message was about"),
    })
    .describe("Where the changes made here stand on their way to this person (F-S4d)"),
});
export const offerablePersonSchema = z.strictObject({
  remoteId: z.string().uuid(),
  displayName: z.string(),
  username: z.string(),
  origin: z.string(),
});
export const tripRemoteSharingSchema = z.strictObject({
  homeOrigin: z
    .string()
    .nullable()
    .describe("The server this trip came from; null when this server is its home"),
  members: z.array(remoteMemberSchema),
  offerable: z.array(offerablePersonSchema),
});
const counts = z.strictObject(
  Object.fromEntries(SHARE_ENTITIES.map((e) => [SHARE_TYPES[e].countKey, z.number().int()]))
);
export const receivedOfferSchema = z.strictObject({
  id: z.string().uuid(),
  from: z.strictObject({ displayName: z.string(), username: z.string(), origin: z.string() }),
  trip: z.strictObject({
    name: z.string(),
    startDay: z.string().nullable(),
    endDay: z.string().nullable(),
  }),
  roster: z.array(z.strictObject({ displayName: z.string(), origin: z.string() })),
  counts,
  offeredAt: instant,
});
export const acceptedOfferSchema = z.strictObject({ tripId: z.string().uuid() });
