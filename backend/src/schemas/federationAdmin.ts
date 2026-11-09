import { z } from "./zod";
import { origin } from "../services/federation/contract";
import { peerOriginRule } from "../services/federation/peerAddressPolicy";

/** A peer address: https without port by default (LAN opt-in: `FEDERATION_PRIVATE_PEERS`), never "local". */
export const httpsOriginSchema = z
  .string()
  .max(250)
  .refine((v) => v !== "local" && origin.safeParse(v).success, {
    error: () => peerOriginRule(),
  });

export const federationSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  /** Empty (or absent): keep the stored address, else the instance's public URL. */
  origin: z.union([httpsOriginSchema, z.literal("")]).optional(),
});

export const peerPinSchema = z.strictObject({
  origin: httpsOriginSchema,
  publicKey: z.string().min(40).max(500),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  enabled: z.boolean(),
});

/**
 * `POST /peers` from the Companion (spec 2026-11-02 §6): the scanned QR payload (string or
 * object) or the connection file as base64. Both go through the same validation as the
 * explicit-values form; `enabled` defaults to true.
 */
export const peerPinFromQrSchema = z.strictObject({
  qr: z.union([z.string().max(2048), z.record(z.string(), z.unknown())]),
  enabled: z.boolean().default(true),
});
export const peerPinFromFileSchema = z.strictObject({
  connectionFile: z.string().max(100_000),
  enabled: z.boolean().default(true),
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
  source: "settings" | null;
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

/**
 * The step-up fields a Companion's write-scope token adds to the pin, verify and suspend calls
 * (spec 2026-11-02 §6). Documentation only: `adminStepUpGate` reads and strips them before the
 * routes' strict schemas run.
 */
export const adminStepUpFieldsSchema = z.object({
  password: z.string().min(1).max(1024),
  totp: z.string().optional(),
});
