/**
 * Types of the external-services catalogue (forgejo#392,
 * docs/superpowers/specs/2026-10-30-external-services.md).
 */
import type { LlmProviderKind } from "../llm/llmEndpoint";

export const CATEGORY_ORDER = [
  "flight",
  "mapsRoutes",
  "photosLocation",
  "ai",
  "openData",
  "syncMail",
  "instance",
] as const;
export type CategoryId = (typeof CATEGORY_ORDER)[number];

export type ServiceLevel = "instance" | "instanceAndAccount" | "account";
export type CredentialKind = "key" | "oauthClient" | "urlKey" | "url" | "none" | "smtp";
export type Recommended = "free" | "freeCredit" | null;
export type FieldKind = "secret" | "text" | "url" | "number" | "select" | "switch";

/** Where a field is stored. `admin`/`user` are columns of the settings rows. */
export type FieldStore = "admin" | "user" | "smtp";

export interface FieldDef {
  key: string;
  kind: FieldKind;
  expert: boolean;
  store: FieldStore;
  /** Column (admin/user) or SmtpConfig property. */
  column: string;
  options?: readonly string[];
}

/** How a service's `enabled` is stored — the existing switch wherever one exists. */
export type EnabledBinding =
  | { kind: "policy" }
  /** Existing boolean admin columns; enabled = any of them on, writing sets all. */
  | { kind: "adminColumns"; columns: readonly string[] }
  | { kind: "smtp" }
  | { kind: "federation" }
  | { kind: "push" }
  | { kind: "usageStats" };

export type TesterId =
  | "airlabs"
  | "aviationstack"
  | "aerodatabox"
  | "aeroapi"
  | "adsbx"
  | "adsblol"
  | "opensky"
  | "openrouteservice"
  | "graphhopper"
  | "googlePlaces"
  | "logostream"
  | "immich"
  | "dawarich"
  | "webdav"
  | "ollama"
  | "llmCloud";

export interface ServiceDef {
  id: string;
  category: CategoryId;
  level: ServiceLevel;
  credential: CredentialKind;
  recommended: Recommended;
  /** Works without any credential. */
  keyless: boolean;
  /** Where to get a key; null when there is nothing to get. */
  getKeyUrl: string | null;
  /** `apiKeyResolver` provider id, when the resolver serves this service. */
  resolverProvider?: string;
  /** Server environment variables that can stand in for the instance credential. */
  env: readonly string[];
  enabled: EnabledBinding;
  fields: readonly FieldDef[];
  /** Account-side fields (UserSettings columns) — only for instanceAndAccount / connections. */
  accountFields: readonly FieldDef[];
  /** Field keys that must all hold a value for the instance side to count as configured. */
  requiredFields: readonly string[];
  /** Cloud AI provider: the LLM slot kind. Remote Ollama and custom count as cloud. */
  ai?: { kind: LlmProviderKind };
  tester?: TesterId;
  /** apiQuota provider id for observed/hinted quota. */
  quotaProvider?: "aerodatabox" | "airlabs" | "aviationstack" | "opensky" | "adsbx" | "adsblol";
  /** Account connection (Dawarich, Immich, Strava, WebDAV) rather than an own-key. */
  connection?: boolean;
}

/** Persisted admin policy; every list holds catalogue service ids. */
export interface ExternalServicePolicy {
  disabled: string[];
  accountKeysForbidden: string[];
  connectionsForbidden: string[];
}

/** Persisted per-account preferences. */
export interface ExternalServicePrefs {
  disabled: string[];
  aiConsent: Record<string, string>;
}

export interface LastTest {
  at: string;
  ok: boolean;
  reason: string | null;
}
