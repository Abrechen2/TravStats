import { z } from "zod";

/**
 * Zod schemas for the device-pairing routes (`/api/v1/pairing`).
 *
 * `claim` is the only body-carrying public endpoint — the mobile app posts the
 * plaintext pairing code plus device metadata to exchange it for a device PAT.
 */

export const claimPairingSchema = z
  .object({
    code: z.string().trim().min(1, "Pairing code is required").max(80),
    deviceName: z.string().trim().min(1).max(80).optional(),
    deviceId: z.string().trim().min(1).max(200).optional(),
    platform: z.string().trim().max(40).optional(),
    appVersion: z.string().trim().max(40).optional(),
  })
  .strict();

export type ClaimPairingInput = z.infer<typeof claimPairingSchema>;
