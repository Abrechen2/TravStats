/**
 * Wire schemas of the external-services routes (forgejo#392): request bodies
 * (strict — a typo must not look like a save) and the response shapes the
 * OpenAPI entries document.
 */
import { z } from "./zod";

const fieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const adminServiceUpdateSchema = z.strictObject({
  enabled: z.boolean().optional(),
  allowAccountKeys: z.boolean().optional(),
  fields: z.record(z.string(), fieldValue).optional(),
  /** Required to switch on a cloud AI provider (400 CONSENT_REQUIRED without it). */
  confirmDataSharing: z.boolean().optional(),
});

export const connectionAllowedSchema = z.strictObject({ allowed: z.boolean() });

export const accountServiceUpdateSchema = z.strictObject({
  fields: z.record(z.string(), fieldValue).optional(),
  accountDisabled: z.boolean().optional(),
});

export const aiConsentParamsSchema = z.strictObject({
  provider: z.enum(["ollama", "openai", "anthropic", "google", "custom"]),
});
export const aiConsentBodySchema = z.strictObject({ consent: z.boolean() });

const lastTest = z
  .object({ at: z.string(), ok: z.boolean(), reason: z.string().nullable() })
  .nullable();

const quota = z
  .object({
    kind: z.enum(["budget", "monthly", "daily", "rateLimit", "none"]),
    used: z.number().optional(),
    limit: z.number().optional(),
    unit: z.string().optional(),
    resetsAt: z.string().optional(),
  })
  .nullable();

const fieldView = z.object({
  key: z.string(),
  kind: z.enum(["secret", "text", "url", "number", "select", "switch"]),
  value: fieldValue,
  masked: z.boolean().optional().describe("Secret fields: `•••• last4`; echo it back to keep"),
  expert: z.boolean(),
  options: z.array(z.string()).optional().describe("`select` fields: the allowed values"),
});

export const adminServiceViewSchema = z.object({
  id: z.string(),
  category: z.string(),
  level: z.enum(["instance", "instanceAndAccount", "account"]),
  credential: z.enum(["key", "oauthClient", "urlKey", "url", "none", "smtp"]),
  keyless: z.boolean(),
  getKeyUrl: z.string().nullable(),
  recommended: z.enum(["free", "freeCredit"]).nullable(),
  enabled: z.boolean(),
  configured: z.boolean(),
  instanceSource: z.enum(["instance", "env", "none"]),
  allowAccountKeys: z.boolean().nullable(),
  lastTest,
  quota,
  fields: z.array(fieldView),
  consent: z
    .object({ allowedByAdmin: z.boolean(), accountsConsented: z.number().int() })
    .optional(),
});

export const adminExternalServicesResponseSchema = z.object({
  categories: z.array(z.object({ id: z.string(), services: z.array(adminServiceViewSchema) })),
  accountConnections: z.array(
    z.object({
      id: z.enum(["dawarich", "immich", "strava", "webdav"]),
      allowed: z.boolean(),
      connectedAccounts: z.number().int(),
    })
  ),
});

export const accountServiceViewSchema = z.object({
  id: z.string(),
  recommended: z.enum(["free", "freeCredit"]).nullable(),
  effectiveSource: z.enum(["account", "instance", "env", "none", "off"]),
  accountDisabled: z.boolean(),
  configured: z.boolean(),
  lastTest,
  quota,
  fields: z.array(fieldView),
});

export const accountExternalServicesResponseSchema = z.object({
  connections: z.array(accountServiceViewSchema),
  ownKeys: z.array(accountServiceViewSchema),
  aiConsents: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      destination: z.string(),
      consentedAt: z.string().nullable(),
    })
  ),
  instanceProvided: z.array(
    z.object({
      id: z.string(),
      enabled: z.boolean(),
      recommended: z.enum(["free", "freeCredit"]).nullable(),
    })
  ),
});

export const serviceTestResponseSchema = z.object({
  ok: z.boolean(),
  reason: z.string().nullable(),
  usedQuota: z.boolean().describe("Whether the test spent provider quota"),
  lastTest,
});

export const aiConsentResponseSchema = z.object({
  provider: z.string(),
  consentedAt: z.string().nullable(),
});
