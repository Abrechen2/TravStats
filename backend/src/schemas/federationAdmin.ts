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

/** Trip sharing across servers (spec 2026-10-20 F8): the admin's own switch, default off. */
export const tripSharingSwitchSchema = z.strictObject({ enabled: z.boolean() });

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
  /**
   * A private key is stored (or the env identity holds one), even while `fingerprint` is null
   * because federation is off or the address is missing. "Schlüssel erzeugen" asks first then.
   */
  hasKey: boolean;
  /** The admin's trip-sharing switch; effective only with an identity and the beta switch on. */
  tripSharingEnabled: boolean;
  peers: Array<{
    origin: string;
    fingerprint: string;
    enabled: boolean;
    verifiedAt: string | null;
    leaderboardVersions: number[];
  }>;
}

/** What `POST /admin/federation/connection-file/inspect` read from a file — nothing is pinned. */
export const connectionFileInspectionSchema = z.object({
  origin: z.string(),
  publicKey: z.string().describe("SPKI PEM, exactly the text the fingerprint hashes"),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  existingPeer: z
    .object({ fingerprint: z.string(), sameKey: z.boolean() })
    .nullable()
    .describe("The server is already pinned; `sameKey` false means the file replaces its key"),
});
export type ConnectionFileInspection = z.infer<typeof connectionFileInspectionSchema>;
