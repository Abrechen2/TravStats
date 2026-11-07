/**
 * Server admission (spec 2026-11-07 §6.2): the public identity another server reads, and the
 * shapes of the admission queue. Bare family (the identity and admin routes); the user-facing
 * routes in `routes/comparison.ts` wrap these in the router's `{success, data}` envelope.
 */
import { z } from "zod";

export const federationIdentityResponseSchema = z.strictObject({
  origin: z.string(),
  /** The raw 32-byte Ed25519 public key, base64url. */
  publicKey: z.string(),
  /** SHA-256 of the SPKI PEM, hex — the same text the admin screen shows. */
  fingerprint: z.string(),
  protocolVersions: z.array(z.number().int()),
});
export type FederationIdentityResponse = z.infer<typeof federationIdentityResponseSchema>;

/**
 * The bootstrap admission action (spec 2026-11-07 §6.2 step 4): a server that is not pinned asks
 * to be admitted, with the invitation token one of this server's users handed out. The origin
 * repeats the envelope's so a body cannot be replayed by another sender.
 */
export const admitRequestSchema = z.strictObject({
  action: z.literal("admit"),
  origin: z.string().max(250),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export type AdmitRequest = z.infer<typeof admitRequestSchema>;

/** Only ever sent to a sender whose signature and token were both verified. */
export const admitReplySchema = z.strictObject({
  status: z.enum(["pending", "approved", "declined", "refused"]),
  reason: z.enum(["full", "duplicate", "expired"]).optional(),
});
export type AdmitReply = z.infer<typeof admitReplySchema>;
