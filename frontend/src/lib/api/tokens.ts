/**
 * API Token (PAT) management — only callable via the cookie-authenticated
 * browser session. The backend explicitly blocks PAT-authenticated
 * requests from these routes so a leaked agent token can't bootstrap
 * a new admin token.
 *
 * The plaintext token is returned exactly once on create. The
 * frontend MUST surface a "save now, never shown again" warning.
 */

import { api } from "./client";

export type ApiTokenScope = "read" | "write" | "admin";

export interface ApiToken {
  id: string;
  label: string;
  scope: ApiTokenScope;
  prefix: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Non-null only for tokens minted via the mobile pairing flow. */
  deviceId: string | null;
  /** Device platform reported at pairing time (e.g. "ios", "android"). */
  platform: string | null;
}

export interface CreatedApiToken extends ApiToken {
  /** Plaintext token. Returned once on create — never persisted client-side beyond the dialog. */
  plaintext: string;
}

export interface CreateApiTokenInput {
  label: string;
  scope?: ApiTokenScope;
  expiresAt?: string | null;
}

export const apiTokensApi = {
  list: async (): Promise<ApiToken[]> => {
    const { data } = await api.get<{ tokens: ApiToken[] }>("/settings/tokens");
    return data.tokens;
  },

  create: async (input: CreateApiTokenInput): Promise<CreatedApiToken> => {
    const { data } = await api.post<CreatedApiToken>("/settings/tokens", input);
    return data;
  },

  revoke: async (id: string): Promise<ApiToken> => {
    const { data } = await api.delete<ApiToken>(`/settings/tokens/${id}`);
    return data;
  },

  /** Permanently remove one revoked or expired token; an active one is refused with `TOKEN_STILL_ACTIVE`. */
  remove: async (id: string): Promise<void> => {
    await api.delete(`/settings/tokens/${id}/purge`);
  },

  /** Remove every revoked or expired token of the caller (`devicesOnly`: paired phones only); resolves with how many went. */
  removeOld: async (opts: { devicesOnly?: boolean } = {}): Promise<number> => {
    const { data } = await api.post<{ removed: number }>(
      "/settings/tokens/purge-old",
      undefined,
      opts.devicesOnly ? { params: { devices: "1" } } : undefined
    );
    return data.removed;
  },
};
