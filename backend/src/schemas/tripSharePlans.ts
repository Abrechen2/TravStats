/**
 * Plans over a user connection (spec 2026-11-02 §4), peer kinds of the trip-share protocol.
 *
 * `from` is the SENDER'S own channel for the person, `to` the receiver's (as in `stats-read`):
 * the receiver resolves the pair to its side of the connection, and the connection to the member.
 * A body never names a user, a member or a role - the signed channel is the identity. The host
 * answers every plan call with a `plan-reply`; a refusal reads alike for every cause (peer,
 * connection, switch, membership, plan), so it enumerates nothing.
 *
 * - Host -> member: `plan-invite`.
 * - Member -> host: `plan-join`, `plan-decline`, `plan-leave` and the proxied calls `plan-read`,
 *   `plan-mutate`, `plan-collab`, `plan-notices-read`, `plan-doc-list`, `plan-doc-get`,
 *   `plan-doc-put`, `plan-export`.
 */
import { z } from "./zod";

const uuid = z.string().uuid();
const instant = z.iso.datetime();
const header = { messageId: uuid, sentAt: instant };
const address = { ...header, from: uuid, to: uuid };

/** Base64 of the largest plan document (20 MB) with room for the other fields. */
export const PLAN_DOC_BASE64_MAX = 28_000_000;

export const planInviteSchema = z.strictObject({
  kind: z.literal("plan-invite"),
  ...address,
  planId: uuid,
  tripId: uuid,
  tripTitle: z.string().trim().min(1).max(200),
  ownerDisplayName: z.string().trim().min(1).max(160),
});
const onPlan = { ...address, planId: uuid };
export const planJoinSchema = z.strictObject({ kind: z.literal("plan-join"), ...onPlan });
export const planDeclineSchema = z.strictObject({ kind: z.literal("plan-decline"), ...onPlan });
export const planLeaveSchema = z.strictObject({ kind: z.literal("plan-leave"), ...onPlan });
export const planReadSchema = z.strictObject({
  kind: z.literal("plan-read"),
  ...onPlan,
  /** The ETag the member's client holds; the host answers `notModified` when it still stands. */
  ifNoneMatch: z.string().max(200).optional(),
});
/** The body is the ordinary plan write (`writeSchema`), validated by the host, never trusted. */
export const planMutateSchema = z.strictObject({
  kind: z.literal("plan-mutate"),
  ...onPlan,
  body: z.json(),
});
export const planCollabSchema = z.strictObject({ kind: z.literal("plan-collab"), ...onPlan });
export const planNoticesReadSchema = z.strictObject({
  kind: z.literal("plan-notices-read"),
  ...onPlan,
});
export const planDocListSchema = z.strictObject({ kind: z.literal("plan-doc-list"), ...onPlan });
export const planDocGetSchema = z.strictObject({
  kind: z.literal("plan-doc-get"),
  ...onPlan,
  documentId: uuid,
});
export const planDocPutSchema = z.strictObject({
  kind: z.literal("plan-doc-put"),
  ...onPlan,
  name: z.string().min(1).max(255),
  mimetype: z.string().min(1).max(120),
  bookingId: uuid.optional(),
  dataBase64: z.string().min(1).max(PLAN_DOC_BASE64_MAX),
});
export const planExportSchema = z.strictObject({ kind: z.literal("plan-export"), ...onPlan });

export const PLAN_PROXY_KINDS = [
  "plan-read",
  "plan-mutate",
  "plan-collab",
  "plan-notices-read",
  "plan-doc-list",
  "plan-doc-get",
  "plan-doc-put",
  "plan-export",
] as const;

export const PLAN_PACKETS = [
  planInviteSchema,
  planJoinSchema,
  planDeclineSchema,
  planLeaveSchema,
  planReadSchema,
  planMutateSchema,
  planCollabSchema,
  planNoticesReadSchema,
  planDocListSchema,
  planDocGetSchema,
  planDocPutSchema,
  planExportSchema,
] as const;

export type PlanInvite = z.infer<typeof planInviteSchema>;
export type PlanJoin = z.infer<typeof planJoinSchema>;
export type PlanDecline = z.infer<typeof planDeclineSchema>;
export type PlanLeave = z.infer<typeof planLeaveSchema>;
export type PlanRead = z.infer<typeof planReadSchema>;
export type PlanMutate = z.infer<typeof planMutateSchema>;
export type PlanCollabRead = z.infer<typeof planCollabSchema>;
export type PlanNoticesRead = z.infer<typeof planNoticesReadSchema>;
export type PlanDocList = z.infer<typeof planDocListSchema>;
export type PlanDocGet = z.infer<typeof planDocGetSchema>;
export type PlanDocPut = z.infer<typeof planDocPutSchema>;
export type PlanExport = z.infer<typeof planExportSchema>;
export type PlanProxyPacket =
  | PlanRead
  | PlanMutate
  | PlanCollabRead
  | PlanNoticesRead
  | PlanDocList
  | PlanDocGet
  | PlanDocPut
  | PlanExport;
export type PlanPacket = PlanInvite | PlanJoin | PlanDecline | PlanLeave | PlanProxyPacket;

const reply = { kind: z.literal("plan-reply") };
/**
 * `ok` carries JSON (`data`), or - for a read the member already holds - `notModified`. `file`
 * carries bytes. `notShared` is the one refusal for every cause of "not yours": nothing says which.
 * `notFound` is a thing the member may see that is not there (a document). `error` is the plan's
 * own refusal (a 409 conflict, a 400 validation, a 413), passed through with its machine code.
 */
export const planReplySchema = z.union([
  z.strictObject({
    ...reply,
    status: z.literal("ok"),
    etag: z.string().max(200).optional(),
    notModified: z.boolean().optional(),
    data: z.json().optional(),
  }),
  z.strictObject({
    ...reply,
    status: z.literal("file"),
    filename: z.string().max(255),
    contentType: z.string().max(200),
    dataBase64: z.string().max(PLAN_DOC_BASE64_MAX),
  }),
  z.strictObject({ ...reply, status: z.literal("notShared") }),
  z.strictObject({ ...reply, status: z.literal("notFound") }),
  z.strictObject({
    ...reply,
    status: z.literal("error"),
    httpStatus: z.number().int().min(400).max(599),
    message: z.string().max(500),
    code: z.string().max(80).optional(),
    field: z.string().max(80).optional(),
    extra: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
]);
export type PlanReply = z.infer<typeof planReplySchema>;
