import { z } from "zod";

/**
 * Zod schemas for the device-pairing routes (`/api/v1/pairing`).
 *
 * `claim` and `status` both carry the plaintext pairing code in the body: the
 * mobile app posts it (plus device metadata) to exchange it for a device PAT,
 * and the browser posts it to poll the claim state.
 */

/**
 * A pairing code is always `clm_` followed by 32 lowercase hex chars (16 random
 * bytes). Validating the shape here rejects malformed codes before they reach
 * the DB lookup, shrinking the attack surface of the public claim endpoint.
 */
const pairingCodeSchema = z
  .string()
  .trim()
  .regex(/^clm_[0-9a-f]{32}$/, "Invalid pairing code");

export const claimPairingSchema = z
  .object({
    code: pairingCodeSchema,
    deviceName: z.string().trim().min(1).max(80).optional(),
    deviceId: z.string().trim().min(1).max(200).optional(),
    platform: z.string().trim().max(40).optional(),
    appVersion: z.string().trim().max(40).optional(),
  })
  .strict();

export type ClaimPairingInput = z.infer<typeof claimPairingSchema>;

export const statusPairingSchema = z.object({ code: pairingCodeSchema }).strict();

export type StatusPairingInput = z.infer<typeof statusPairingSchema>;
