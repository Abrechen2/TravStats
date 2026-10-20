/**
 * `/api/v1/sharing/remote/*` — the user's side of trip sharing across servers (spec 2026-10-20,
 * phase F-S4b): request bodies and the response shapes the OpenAPI spec publishes.
 */
import { z } from "./zod";
import { CONSENT_STATUSES } from "./sharing";

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
