import { z } from "./zod";
import { origin } from "../services/federation/contract";

/** A peer address: https, no port, path or credentials, never the "local" placeholder. */
export const httpsOriginSchema = z
  .string()
  .max(250)
  .refine((v) => v !== "local" && origin.safeParse(v).success, {
    message: "An https origin without port, path or credentials",
  });

export const federationSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  origin: httpsOriginSchema,
});

export const peerPinSchema = z.strictObject({
  origin: httpsOriginSchema,
  publicKey: z.string().min(40).max(500),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(),
});

export const peerOriginSchema = z.strictObject({ origin: httpsOriginSchema });

/** `leaderboard` is absent on servers that predate the leaderboard protocol (spec §10). */
export const pingReplySchema = z.object({
  ready: z.literal(true),
  leaderboard: z.array(z.number().int().positive()).max(8).optional(),
});

export interface FederationState {
  source: "env" | "settings" | null;
  enabled: boolean;
  origin: string | null;
  publicKey: string | null;
  fingerprint: string | null;
  peers: Array<{
    origin: string;
    fingerprint: string;
    enabled: boolean;
    verifiedAt: string | null;
    leaderboardVersions: number[];
  }>;
}
