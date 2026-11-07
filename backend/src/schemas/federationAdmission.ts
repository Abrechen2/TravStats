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
