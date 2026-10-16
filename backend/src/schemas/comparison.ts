/**
 * The leaderboard's shapes (comparison rework 2026-10-16, spec §9): the consent scope, the
 * versioned totals snapshot that may cross a server boundary, the three leaderboard peer
 * messages and the cookie API. Totals only — nothing here can carry a record, a name of a
 * trip or place, a date or a cost.
 */
import { z } from "./zod";
import { AVAILABLE_DOMAINS, type DomainKey } from "../shared/domains";
import { METRIC_GROUPS } from "../shared/comparisonMetrics";

const unique = <T>(list: readonly T[]) => new Set(list).size === list.length;
const year = z.number().int().min(1900).max(2200);
const uuid = z.string().uuid();

export const LEADERBOARD_SCHEMA = "travstats-leaderboard" as const;
/** Snapshot versions this server reads and serves. */
export const SERVED_VERSIONS = [1] as const;

export const leaderboardScopeSchema = z.strictObject({
  groups: z
    .array(z.enum(METRIC_GROUPS))
    .min(1)
    .max(METRIC_GROUPS.length)
    .refine(unique, "No duplicates"),
  domains: z
    .array(z.enum(AVAILABLE_DOMAINS as [DomainKey, ...DomainKey[]]))
    .min(1)
    .max(AVAILABLE_DOMAINS.length)
    .refine(unique, "No duplicates"),
  /** null: every year and the lifetime view; a number: that year only. */
  year: year.nullable(),
});

const metricName = z.string().regex(/^[a-zA-Z]{1,40}$/);
/**
 * Checked on the RAW input, before the record parses: zod builds its result by plain assignment,
 * so an own "__proto__" key from JSON.parse would otherwise vanish silently and pass.
 */
const notPrototypeName = (raw: unknown) =>
  typeof raw === "object" &&
  raw !== null &&
  !Object.keys(raw).some((k) => Object.prototype.hasOwnProperty.call(Object.prototype, k));

export const leaderboardSnapshotSchema = z.strictObject({
  schema: z.literal(LEADERBOARD_SCHEMA),
  version: z.literal(1),
  asOf: z.string().datetime(),
  year: year.nullable(),
  domains: z.array(z.string().max(30)).max(20),
  /**
   * A record, not an object of known keys: a newer server may send a metric this one does not
   * know, and the receiver shows only the keys of its own catalogue. Absent = not shared;
   * null = shared but not derivable; never 0 for "unknown".
   */
  metrics: z
    .unknown()
    .refine(notPrototypeName, "Reserved metric name")
    .pipe(
      z
        .record(metricName, z.number().finite().nonnegative().nullable())
        .refine((m) => Object.keys(m).length <= 64, "At most 64 metrics")
    ),
  /** Metrics that are a lower bound (some rides carry no distance). */
  partial: z.array(metricName).max(64),
});

export const aggregateRequestSchema = z.strictObject({
  action: z.literal("aggregate"),
  channel: uuid,
  year: year.nullable(),
  accept: z.array(z.number().int().positive()).min(1).max(8),
});
export const lbClaimRequestSchema = z.strictObject({
  action: z.literal("lb-claim"),
  code: z.string().regex(/^[a-f0-9]{64}$/),
  username: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(160),
});
export const lbStateRequestSchema = z.strictObject({
  action: z.literal("lb-state"),
  channel: uuid,
  status: z.literal("withdrawn"),
});

export const aggregateReplySchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ok"), snapshot: leaderboardSnapshotSchema }),
  z.strictObject({ status: z.literal("notShared") }),
  z.strictObject({ status: z.literal("withdrawn") }),
  z.strictObject({ status: z.literal("yearNotShared"), year }),
  z.strictObject({
    status: z.literal("unsupportedVersion"),
    supported: z.array(z.number().int().positive()).max(8),
  }),
]);
export const lbClaimReplySchema = z.union([
  z.strictObject({
    accepted: z.literal(true),
    channel: uuid,
    username: z.string().max(80),
    displayName: z.string().max(160),
  }),
  z.strictObject({ accepted: z.literal(false) }),
]);

export const personKeySchema = z
  .string()
  .regex(/^(local|remote):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const uuidParamSchema = uuid;
export const leaderboardQuerySchema = z.strictObject({
  year: z.union([z.literal("all"), z.coerce.number().int().min(1900).max(2200)]).default("all"),
  board: uuid.optional(),
});
export const consentRequestBodySchema = z.strictObject({
  username: z.string().trim().min(1).max(80),
  scope: leaderboardScopeSchema,
});
export const scopeBodySchema = z.strictObject({ scope: leaderboardScopeSchema });
export const claimBodySchema = z.strictObject({
  code: z.string().trim().min(1).max(400),
  scope: leaderboardScopeSchema,
});
export const boardBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  members: z.array(personKeySchema).max(70),
});

export const personSchema = z.strictObject({
  key: z.string(),
  kind: z.enum(["self", "local", "remote"]),
  username: z.string(),
  displayName: z.string(),
  /** The other server's origin; null on this server. */
  origin: z.string().nullable(),
});
export const rowStatusSchema = z.enum([
  "ok",
  "notShared",
  "yearNotShared",
  "withdrawn",
  "unreachable",
  "outdated",
  "federationOff",
]);
export const consentStatusSchema = z.enum(["pending", "accepted", "declined", "withdrawn"]);
export const leaderboardRowSchema = z.strictObject({
  person: personSchema,
  status: rowStatusSchema,
  snapshot: leaderboardSnapshotSchema.nullable(),
  /** The one year this person shares, when they share only one. */
  sharedYear: year.nullable(),
});
export const leaderboardResponseSchema = z.strictObject({
  year: year.nullable(),
  rows: z.array(leaderboardRowSchema),
});
export const personViewSchema = z.strictObject({
  person: personSchema,
  /** The caller's own consent to this person. */
  mine: z
    .strictObject({
      consentId: uuid,
      status: consentStatusSchema,
      scope: leaderboardScopeSchema.nullable(),
    })
    .nullable(),
  /** This person's consent to the caller; null for a remote person (their server holds it). */
  theirs: z.strictObject({ status: consentStatusSchema }).nullable(),
});
export const requestViewSchema = z.strictObject({
  consentId: uuid,
  person: personSchema,
  createdAt: z.string().datetime(),
});
export const boardViewSchema = z.strictObject({
  id: uuid,
  name: z.string(),
  members: z.array(personKeySchema),
});
export const peopleResponseSchema = z.strictObject({
  requests: z.array(requestViewSchema),
  people: z.array(personViewSchema),
  boards: z.array(boardViewSchema),
});
export const inviteResponseSchema = z.strictObject({
  code: z.string(),
  expiresAt: z.string().datetime(),
});

export type LeaderboardScope = z.infer<typeof leaderboardScopeSchema>;
export type LeaderboardSnapshot = z.infer<typeof leaderboardSnapshotSchema>;
export type AggregateRequest = z.infer<typeof aggregateRequestSchema>;
export type AggregateReply = z.infer<typeof aggregateReplySchema>;
export type LbClaimRequest = z.infer<typeof lbClaimRequestSchema>;
export type LbClaimReply = z.infer<typeof lbClaimReplySchema>;
export type LbStateRequest = z.infer<typeof lbStateRequestSchema>;
export type Person = z.infer<typeof personSchema>;
export type RowStatus = z.infer<typeof rowStatusSchema>;
export type ConsentStatus = z.infer<typeof consentStatusSchema>;
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
export type PersonView = z.infer<typeof personViewSchema>;
export type RequestView = z.infer<typeof requestViewSchema>;
export type BoardView = z.infer<typeof boardViewSchema>;
