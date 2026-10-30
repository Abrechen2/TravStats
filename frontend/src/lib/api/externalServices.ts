import { api } from "./client";

/**
 * `/admin/external-services` and `/settings/external-services` (forgejo#392).
 *
 * The types ARE the contract in
 * `docs/superpowers/specs/2026-10-30-external-services.md`; the page reads the
 * catalogue from the API and keeps only the copy (names, purposes, info rows)
 * in the `externalServices` i18n namespace, keyed by service id.
 */

export type ServiceLevel = "instance" | "instanceAndAccount" | "account";
export type ServiceRecommended = "free" | "freeCredit" | null;
export type ServiceFieldKind = "secret" | "text" | "url" | "number" | "select" | "switch";
export type ConnectionId = "dawarich" | "immich" | "strava" | "webdav";

export interface ServiceField {
  key: string;
  kind: ServiceFieldKind;
  /** A secret arrives masked (`•••• last4`); it is never the clear value. */
  value: string | number | boolean | null;
  masked?: boolean;
  /** Choices of a `select` field; without them the field is drawn as text. */
  options?: string[];
  /** Hidden in the standard view (addresses, endpoints, source order). */
  expert: boolean;
}

export interface ServiceLastTest {
  at: string;
  ok: boolean;
  reason: string | null;
}

export interface ServiceQuota {
  kind: "budget" | "monthly" | "daily" | "rateLimit" | "none";
  used?: number;
  limit?: number;
  unit?: string;
  resetsAt?: string;
}

export type InstanceSource = "instance" | "env" | "none";

export type ServiceCredential = "key" | "oauthClient" | "urlKey" | "url" | "none" | "smtp";

export interface AdminService {
  id: string;
  /** Catalogue category id (the response also groups by it). */
  category: string;
  credential: ServiceCredential;
  /** Works without any credential. */
  keyless: boolean;
  /** Where to get a key; null when there is nothing to get. */
  getKeyUrl: string | null;
  level: ServiceLevel;
  recommended: ServiceRecommended;
  enabled: boolean;
  configured: boolean;
  instanceSource: InstanceSource;
  allowAccountKeys: boolean | null;
  lastTest: ServiceLastTest | null;
  quota: ServiceQuota | null;
  fields: ServiceField[];
  consent?: { allowedByAdmin: boolean; accountsConsented: number };
}

export interface AdminCategory {
  id: string;
  services: AdminService[];
}

export interface AdminConnectionPolicy {
  id: ConnectionId;
  allowed: boolean;
  connectedAccounts: number;
}

export interface AdminExternalServices {
  categories: AdminCategory[];
  accountConnections: AdminConnectionPolicy[];
}

export interface AdminServiceUpdate {
  enabled?: boolean;
  allowAccountKeys?: boolean;
  fields?: Record<string, unknown>;
  /** Required when enabling a cloud AI provider (400 `CONSENT_REQUIRED` otherwise). */
  confirmDataSharing?: boolean;
}

export interface ServiceTestResult {
  ok: boolean;
  reason: string | null;
  usedQuota: boolean;
}

export type EffectiveSource = "account" | "instance" | "env" | "none" | "off";

export interface AccountService {
  id: string;
  recommended: ServiceRecommended;
  effectiveSource: EffectiveSource;
  accountDisabled: boolean;
  configured: boolean;
  lastTest: ServiceLastTest | null;
  fields: ServiceField[];
}

export interface AccountAiConsent {
  id: string;
  provider: string;
  destination: string;
  consentedAt: string | null;
}

export interface InstanceProvidedService {
  id: string;
  enabled: boolean;
  recommended: ServiceRecommended;
}

export interface AccountExternalServices {
  connections: AccountService[];
  ownKeys: AccountService[];
  aiConsents: AccountAiConsent[];
  instanceProvided: InstanceProvidedService[];
}

export interface AccountServiceUpdate {
  fields?: Record<string, unknown>;
  accountDisabled?: boolean;
}

/** The closed set of codes the routes answer with (`{ error, code }`). */
export const EXTERNAL_SERVICE_ERROR_CODES = [
  "SERVICE_DISABLED",
  "CONSENT_REQUIRED",
  "ACCOUNT_KEYS_NOT_ALLOWED",
  "CONNECTION_NOT_ALLOWED",
  "VALIDATION_FAILED",
  "SERVICE_NOT_FOUND",
] as const;
export type ExternalServiceErrorCode = (typeof EXTERNAL_SERVICE_ERROR_CODES)[number];

/** A test can outlast the 10 s default: the tester calls the provider. */
const TEST_TIMEOUT_MS = 40_000;

const admin = "/admin/external-services";
const account = "/settings/external-services";

export const externalServicesApi = {
  async adminOverview(): Promise<AdminExternalServices> {
    return (await api.get<AdminExternalServices>(admin)).data;
  },
  async adminUpdate(id: string, body: AdminServiceUpdate): Promise<void> {
    await api.put(`${admin}/${encodeURIComponent(id)}`, body);
  },
  async adminSetConnection(id: ConnectionId, allowed: boolean): Promise<void> {
    await api.put(`${admin}/connections/${id}`, { allowed });
  },
  async adminTest(id: string): Promise<ServiceTestResult> {
    return (
      await api.post<ServiceTestResult>(
        `${admin}/${encodeURIComponent(id)}/test`,
        {},
        { timeout: TEST_TIMEOUT_MS }
      )
    ).data;
  },
  async accountOverview(): Promise<AccountExternalServices> {
    return (await api.get<AccountExternalServices>(account)).data;
  },
  async accountUpdate(id: string, body: AccountServiceUpdate): Promise<void> {
    await api.put(`${account}/${encodeURIComponent(id)}`, body);
  },
  async accountSetAiConsent(provider: string, consent: boolean): Promise<void> {
    await api.put(`${account}/ai-consent/${encodeURIComponent(provider)}`, { consent });
  },
};
