import { e2eRequest } from "./e2e/wire";
import { origin } from "./envelope";
// The envelope is protocol-neutral and lives in `envelope.ts`; re-exported for the comparison side.
export { origin, signedEnvelope, type Envelope } from "./envelope";
import { z } from "zod";
import { AVAILABLE_DOMAINS } from "../../shared/domains";
import {
  aggregateRequestSchema,
  lbClaimRequestSchema,
  lbStateRequestSchema,
} from "../../schemas/comparison";

export const id = z.string().uuid();
export const label = z.string().trim().min(1).max(80);
export const scopeSchema = z
  .strictObject({
    statistics: z.boolean(),
    details: z.boolean(),
    costs: z.boolean(),
    personal: z.boolean(),
    photos: z.boolean(),
    documents: z.boolean(),
    domains: z
      .array(z.enum(AVAILABLE_DOMAINS as [string, ...string[]]))
      .min(1)
      .max(20),
    tripIds: z.array(id).max(500),
    futureTrips: z.boolean(),
    year: z.number().int().min(1900).max(2200).nullable(),
    precision: z.enum(["exact", "rounded"]),
    expiresAt: z.string().datetime().nullable(),
  })
  .refine((s) => s.details || !(s.personal || s.photos || s.documents), "Details required");
export type Scope = z.infer<typeof scopeSchema>;
export const grantInput = z.strictObject({
  audience: z.string().max(100).default(""),
  scope: scopeSchema,
});
export const circleRequest = z.strictObject({
  action: z.literal("circle"),
  operation: z.enum(["list", "info", "accept", "leave"]),
  channel: id,
  circleId: id.optional(),
  version: z.number().int().positive().optional(),
});
export const circleMember = z.strictObject({ channel: id, label, origin, accepted: z.boolean() });
export const circleSchema = z.strictObject({
  id,
  name: label,
  version: z.number().int().positive(),
  members: z.array(circleMember).max(19),
});
export type Circle = z.infer<typeof circleSchema>;
export const packetBody = z.discriminatedUnion("action", [
  e2eRequest,
  circleRequest,
  z.strictObject({ action: z.literal("ping") }),
  z.strictObject({
    action: z.literal("claim"),
    code: z.string().regex(/^[a-f0-9]{64}$/),
    channel: id,
  }),
  z.strictObject({
    action: z.literal("state"),
    channel: id,
    confirmed: z.boolean(),
    revoked: z.boolean(),
  }),
  aggregateRequestSchema,
  lbClaimRequestSchema,
  lbStateRequestSchema,
]);
export type PeerBody = z.infer<typeof packetBody>;
export const claimInput = z.strictObject({
  origin,
  code: z.string().regex(/^[a-f0-9]{64}$/),
  label,
});
export const metricSchema = z.strictObject({
  cruises: z.number().nonnegative().nullable().optional(),
  cruiseDistance: z.number().nonnegative().nullable().optional(),
  cruisePorts: z.number().nonnegative().nullable().optional(),
  stays: z.number().nonnegative().nullable().optional(),
  nights: z.number().nonnegative().nullable().optional(),
  railRides: z.number().nonnegative().nullable().optional(),
  railTicketKm: z.number().nonnegative().nullable().optional(),
  railTracedKm: z.number().nonnegative().nullable().optional(),
  railStraightKm: z.number().nonnegative().nullable().optional(),
  busRides: z.number().nonnegative().nullable().optional(),
  busTicketKm: z.number().nonnegative().nullable().optional(),
  busRouteKm: z.number().nonnegative().nullable().optional(),
  rentals: z.number().nonnegative().nullable().optional(),
  rentalDays: z.number().nonnegative().nullable().optional(),
  rentalKm: z.number().nonnegative().nullable().optional(),

  flights: z.number().nonnegative().nullable(),
  distance: z.number().nonnegative().nullable(),
  minutes: z.number().nonnegative().nullable(),
  countries: z.number().nonnegative().nullable(),
  daysAway: z.number().nonnegative().nullable(),
  cost: z.number().nonnegative().nullable(),
});
export const snapshotSchema = z.strictObject({
  version: z.literal(1),
  definition: z.literal("travstats-comparison-1"),
  asOf: z.string().datetime(),
  year: z.number().int().nullable(),
  precision: z.enum(["exact", "rounded"]),
  coverage: z.enum(["all", "selection"]),
  domains: z.array(z.string().max(30)).max(20),
  currency: z.string().length(3),
  metrics: metricSchema,
  details: z.boolean(),
  trips: z.array(z.strictObject({ id, name: z.string().max(1000) })).max(500),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
