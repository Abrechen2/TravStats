import { z } from 'zod';

import { API_TOKEN_SCOPES } from '../utils/apiTokens';

/**
 * Zod schemas for the Personal Access Token (PAT) routes.
 *
 * Note: the create response carries the plaintext token — that's the
 * one and only time it's ever returned by the API. Every other route
 * returns only the sanitized shape (no `plaintext`, no `hash`, no
 * `lookupHash`).
 */

export const apiTokenScopeSchema = z.enum(API_TOKEN_SCOPES as unknown as [string, ...string[]]);

export const createApiTokenSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, 'Label is required')
      .max(80, 'Label must be 80 characters or fewer'),
    scope: apiTokenScopeSchema.default('read'),
    expiresAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .nullable(),
  })
  .strict();

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

export const sanitizedApiTokenShape = {
  id: z.string().uuid(),
  label: z.string(),
  scope: apiTokenScopeSchema,
  prefix: z.string(),
  lastUsedAt: z.string().datetime().nullable(),
  lastUsedIp: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
} as const;

export const sanitizedApiTokenSchema = z.object(sanitizedApiTokenShape);
export type SanitizedApiToken = z.infer<typeof sanitizedApiTokenSchema>;

/**
 * Returned exactly once on POST /tokens. Includes `plaintext` so the
 * client can show "copy this — it will not be shown again".
 */
export const createdApiTokenSchema = z.object({
  ...sanitizedApiTokenShape,
  plaintext: z.string(),
});
export type CreatedApiToken = z.infer<typeof createdApiTokenSchema>;
