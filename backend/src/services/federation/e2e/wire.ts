import { z } from "zod";
export const uuid = z.string().uuid();
export const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const b64 = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const deviceSchema = z.strictObject({
  id: uuid,
  name: z.string().trim().min(1).max(80),
  encryption: b64(180),
  signing: b64(180),
  fingerprint,
});
export type PublicDevice = z.infer<typeof deviceSchema>;
export const contextSchema = z.strictObject({
  version: z.literal(2),
  id: uuid,
  channel: uuid,
  audience: z.string().max(100),
  revision: z.number().int().positive(),
  sender: fingerprint,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export const manifestSchema = z.strictObject({
  context: contextSchema,
  ephemeral: b64(180),
  recipients: z
    .array(z.strictObject({ fingerprint, iv: b64(20), key: b64(80) }))
    .min(1)
    .max(100),
  digests: z.array(fingerprint).min(1).max(8192),
  indexStart: z.number().int().min(0).max(8191),
  indexCount: z.number().int().positive().max(8192),
  signature: b64(100),
});
export type Manifest = z.infer<typeof manifestSchema>;
export const e2eRequest = z.strictObject({
  action: z.literal("sealed"),
  operation: z.enum(["devices", "read", "group-devices", "group-read"]),
  channel: uuid,
  audience: z.string().max(100).default(""),
  circleId: uuid.optional(),
  source: z.union([uuid, z.literal("host")]).optional(),
  recipient: fingerprint.optional(),
  publication: uuid.optional(),
  part: z.number().int().min(0).max(8191).optional(),
});
export type SealedRequest = z.infer<typeof e2eRequest>;
export const chunkSchema = z.strictObject({
  part: z.number().int().min(0).max(8191),
  bytes: b64(400_000),
});
