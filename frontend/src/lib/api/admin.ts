import { api } from "./client";
import type {
  ApiKeyTestResponse,
  ExportAllDataResponse,
  MessageResponse,
  SmtpConfigInput,
  SmtpConfigResponse,
} from "./types";
import type { RoutingProviderId } from "../../types/tour";
import type {
  LogCleanupResult,
  LogFilesResponse,
  LoggingConfigResponse,
  LogReadResponse,
  LogStatsResponse,
} from "../../shared/logContract";
import type { CountryTier } from "../../types/passport";

export interface InstanceSettings {
  instanceName: string;
  maxUsers: number;
  allowRegistration: boolean;
  /** Instance-wide gate for unfinished features — see config/betaFeatures.ts. */
  betaFeaturesEnabled: boolean;
  /** May the instance ask Open-Meteo, Wikipedia and OpenStreetMap for its users. */
  openDataEnabled: boolean;
  frontendUrl: string | null;
  publicUrl: string | null;
  lanUrl: string | null;
  /** Bare domain a passkey is bound to — never a URL. Null until an admin sets it. */
  webauthnRpId: string | null;
  /** Full origins the browser may be on; the first is the primary. */
  webauthnOrigins: string[];
  // Geocoder base URLs — always resolved (DB > ENV > public default),
  // unlike the nullable URL fields above. See `resolveGeocoderUrls()`.
  photonUrl: string;
  nominatimUrl: string;
  /**
   * The instance's starting point for "a country counts as visited from …".
   * Any user may override it in their own settings; this is what applies until
   * they do. Always resolved — there is no "unset" state to handle.
   */
  countryThreshold: CountryTier;
  /** May the rail train lookup ask Transitous / db-rest (both on by default). */
  railTransitousEnabled: boolean;
  railDbRestEnabled: boolean;
  /** A self-hosted OpenRailRouting for rail lines; null = off. Absent before 2.7. */
  railRoutingUrl?: string | null;
}

/**
 * The OpenRailRouting test (`POST /admin/instance-settings/rail-routing/test`):
 * a stable code on failure, which the card maps to DE/EN copy.
 */
export type RailRoutingTestResult =
  | { ok: true; profile: string; dataDate: string | null }
  | { ok: false; code: "notConfigured" | "unreachable" | "notOpenRailRouting" | "profileMissing" };

/**
 * Whether the SAVED configuration actually yields working passkeys. Derived by
 * the server, never stored — the browser must not re-implement the
 * secure-context rule and drift from it.
 */
export interface PasskeyStatus {
  usable: boolean;
  reason: string | null;
}

export interface InstanceSettingsResponse {
  settings: InstanceSettings;
  passkeyStatus: PasskeyStatus;
}

export interface InstanceSettingsPatch {
  instanceName?: string;
  maxUsers?: number;
  allowRegistration?: boolean;
  betaFeaturesEnabled?: boolean;
  openDataEnabled?: boolean;
  frontendUrl?: string;
  publicUrl?: string;
  lanUrl?: string;
  webauthnRpId?: string;
  webauthnOrigins?: string[];
  // Empty string clears the DB override, reverting to ENV/default.
  photonUrl?: string;
  nominatimUrl?: string;
  countryThreshold?: CountryTier;
  railTransitousEnabled?: boolean;
  railDbRestEnabled?: boolean;
  /** "" switches OpenRailRouting off. */
  railRoutingUrl?: string;
}

/**
 * Who reads a booking document first — the same setting in all four domains
 * (backend `getParserOrder`). Default `template_first`, measured 2026-09-17.
 */
export type ParserOrder = "template_first" | "llm_first";

/**
 * Which protocol the instance's language model speaks (backend
 * `llm/llmProvider.ts`). beta.18: `openai_compatible` was renamed `custom`
 * (a free-form base URL — OpenRouter, Ollama Cloud, a LAN vLLM/LM Studio) and
 * three FIXED-endpoint named slots were added, each with its own key/model/
 * consent. There is no longer a single "active" kind on the admin settings —
 * `llmProvider.ts` resolves a FALLBACK CHAIN (Ollama first, then the
 * enabled+consented cloud slots in `llmProviderOrder`) — `kind` here still
 * names which protocol actually answered a given parse.
 */
export type LlmProviderKind = "ollama" | "openai" | "anthropic" | "google" | "custom";

/** The four cloud slots an admin may enable and order (Ollama is implicit, always first). */
export const CLOUD_PROVIDER_KINDS = ["openai", "anthropic", "google", "custom"] as const;
export type CloudProviderKind = (typeof CLOUD_PROVIDER_KINDS)[number];

export interface AdminParserSettingsResponse {
  allowUserApiKeys: boolean;
  fxCdnFallbackEnabled: boolean;
  /** Who reads a booking document first, in every domain. Absent on a
   *  backend older than 2.7 — treat a missing value as "template_first". */
  parserOrder?: ParserOrder;
  /** The "KI-Parser aus" switch; absent on a backend older than 2.7 (= on). */
  llmEnabled?: boolean;
  ollamaUrl: string | null;
  ollamaModel: string | null;
  /** Consent for a REMOTE Ollama only — the local/LAN case never needs this. */
  llmOllamaOptIn?: boolean;
  /** The admin's priority among the four cloud slots — always all four, in order. */
  llmProviderOrder?: CloudProviderKind[];

  /** The `custom` slot (beta.17's `openai_compatible`) — a free-form base URL. */
  openaiCompatBaseUrl?: string | null;
  openaiCompatModel?: string | null;
  /** Masked ("abcd****wxyz") or null — the key itself never leaves the server. */
  openaiCompatApiKey?: string | null;
  /** The SAVED endpoint is outside the local network. */
  openaiCompatIsCloud?: boolean;
  llmCustomOptIn?: boolean;

  /** OpenAI — fixed endpoint, key + model only. */
  llmOpenaiModel?: string | null;
  llmOpenaiApiKey?: string | null;
  llmOpenaiOptIn?: boolean;
  /** Anthropic — native Messages API, fixed endpoint, key + model only. */
  llmAnthropicModel?: string | null;
  llmAnthropicApiKey?: string | null;
  llmAnthropicOptIn?: boolean;
  /** Google — Gemini's own OpenAI-compatible endpoint, fixed, key + model only. */
  llmGoogleModel?: string | null;
  llmGoogleApiKey?: string | null;
  llmGoogleOptIn?: boolean;
}

/** Stable codes the admin page words itself (`test.errors.*`). */
export type LlmProviderTestErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "credentials_in_url"
  | "https_required"
  | "auth"
  | "unreachable";

export type LlmProviderTestResult =
  | { ok: true; isCloud: boolean; modelCount: number; modelFound: boolean | null }
  | {
      ok: false;
      errorCode: LlmProviderTestErrorCode;
      /** Protocol/status line for the log — never shown raw. */
      detail?: string | null;
      isCloud?: boolean;
    };

/**
 * One password-reset request waiting for an administrator (forgejo#88, point 2).
 * Only reachable with an admin session — see `routes/admin/passwordResetRequests.ts`.
 */
export interface PasswordResetRequest {
  id: string;
  userId: string;
  username: string;
  /** ISO 8601. */
  requestedAt: string;
}

export const adminApi = {
  /**
   * The open password-reset requests.
   *
   * Every caller must be prepared for a 403: the inbox is a normal user's page
   * too, and only the admin half of it may ask for this list.
   */
  getPasswordResetRequests: async (): Promise<{
    requests: PasswordResetRequest[];
    count: number;
  }> => {
    const { data } = await api.get<{ requests: PasswordResetRequest[]; count: number }>(
      "/admin/password-reset-requests"
    );
    return data;
  },

  /** "I have dealt with this" — stamps the request, it leaves the list. */
  markPasswordResetRequestHandled: async (
    id: string
  ): Promise<{ id: string; handledAt: string }> => {
    const { data } = await api.post<{ id: string; handledAt: string }>(
      `/admin/password-reset-requests/${id}/handled`
    );
    return data;
  },

  getSystemInfo: async (): Promise<{
    instanceName: string;
    userCount: number;
    activeUserCount: number;
    flightCount: number;
    maxUsers: number;
    warningThreshold: boolean;
    registrationEnabled: boolean;
    version: string;
    buildVersion: string;
  }> => {
    const { data } = await api.get<{
      instanceName: string;
      userCount: number;
      activeUserCount: number;
      flightCount: number;
      maxUsers: number;
      warningThreshold: boolean;
      registrationEnabled: boolean;
      version: string;
      buildVersion: string;
    }>("/admin/system/info");
    return data;
  },

  getUsers: async (): Promise<{
    users: Array<{
      id: string;
      username: string;
      isAdmin: boolean;
      isActive: boolean;
      invitedBy?: string;
      createdAt: string;
      twoFactorEnabledAt: string | null;
      _count: {
        flights: number;
        userAchievements: number;
      };
    }>;
  }> => {
    const { data } = await api.get<{
      users: Array<{
        id: string;
        username: string;
        isAdmin: boolean;
        isActive: boolean;
        invitedBy?: string;
        createdAt: string;
        twoFactorEnabledAt: string | null;
        _count: {
          flights: number;
          userAchievements: number;
        };
      }>;
    }>("/admin/users");
    return data;
  },

  toggleUserActive: async (
    userId: string
  ): Promise<{
    user: {
      id: string;
      username: string;
      isAdmin: boolean;
      isActive: boolean;
    };
  }> => {
    const { data } = await api.patch<{
      user: {
        id: string;
        username: string;
        isAdmin: boolean;
        isActive: boolean;
      };
    }>(`/admin/users/${userId}/toggle-active`);
    return data;
  },

  /** The way back in for a user who lost both phone and recovery codes. */
  disableUserTwoFactor: async (userId: string): Promise<{ disabled: boolean }> => {
    const { data } = await api.post<{ disabled: boolean }>(`/admin/users/${userId}/disable-2fa`);
    return data;
  },

  deleteUser: async (userId: string): Promise<{ message: string; userId: string }> => {
    const { data } = await api.delete<{ message: string; userId: string }>(
      `/admin/users/${userId}`
    );
    return data;
  },

  createLinkInvitation: async (
    expiresInDays: 1 | 7 | 30 = 7
  ): Promise<{
    invitation: { id: string; email: string | null; token: string; expiresAt: string };
    inviteUrl: string;
  }> => {
    const { data } = await api.post<{
      invitation: { id: string; email: string | null; token: string; expiresAt: string };
      inviteUrl: string;
    }>("/admin/invitations", { expiresInDays });
    return data;
  },

  createEmailInvitation: async (
    email: string,
    expiresInDays: 1 | 7 | 30 = 7
  ): Promise<{
    invitation: { id: string; email: string | null; token: string; expiresAt: string };
    inviteUrl: string;
    emailSent: boolean;
    emailError: string | null;
  }> => {
    const { data } = await api.post<{
      invitation: { id: string; email: string | null; token: string; expiresAt: string };
      inviteUrl: string;
      emailSent: boolean;
      emailError: string | null;
    }>("/admin/invitations/email", { email, expiresInDays });
    return data;
  },

  resendInvitationEmail: async (
    id: string
  ): Promise<{ emailSent: boolean; emailError: string | null }> => {
    const { data } = await api.post<{ emailSent: boolean; emailError: string | null }>(
      `/admin/invitations/${id}/resend`
    );
    return data;
  },

  revokeInvitation: async (id: string): Promise<{ success: true }> => {
    const { data } = await api.delete<{ success: true }>(`/admin/invitations/${id}`);
    return data;
  },

  getInvitations: async (
    status: "all" | "active" | "used" | "expired" = "active"
  ): Promise<{
    invitations: Array<{
      id: string;
      email: string | null;
      token: string;
      expiresAt: string;
      usedAt: string | null;
      createdAt: string;
      emailStatus: string | null;
      emailError: string | null;
      emailSentAt: string | null;
      creator: { username: string };
      user: { username: string } | null;
    }>;
  }> => {
    const { data } = await api.get<{
      invitations: Array<{
        id: string;
        email: string | null;
        token: string;
        expiresAt: string;
        usedAt: string | null;
        createdAt: string;
        emailStatus: string | null;
        emailError: string | null;
        emailSentAt: string | null;
        creator: { username: string };
        user: { username: string } | null;
      }>;
    }>("/admin/invitations", { params: { status } });
    return data;
  },

  exportAllData: async (): Promise<ExportAllDataResponse> => {
    const { data } = await api.get<ExportAllDataResponse>("/admin/export/all-data");
    return data;
  },

  getAdminParserSettings: async (): Promise<AdminParserSettingsResponse> => {
    const { data } = await api.get<AdminParserSettingsResponse>("/admin/parser-settings");
    return data;
  },

  updateAdminParserSettings: async (settings: {
    allowUserApiKeys?: boolean;
    fxCdnFallbackEnabled?: boolean;
    parserOrder?: ParserOrder;
    llmEnabled?: boolean;
    ollamaUrl?: string | null;
    ollamaModel?: string | null;
    llmOllamaOptIn?: boolean;
    llmProviderOrder?: CloudProviderKind[];
    openaiCompatBaseUrl?: string | null;
    openaiCompatModel?: string | null;
    /** The masked echo from the GET keeps the stored key; "" / null clears it. */
    openaiCompatApiKey?: string | null;
    llmCustomOptIn?: boolean;
    llmOpenaiApiKey?: string | null;
    llmOpenaiModel?: string | null;
    llmOpenaiOptIn?: boolean;
    llmAnthropicApiKey?: string | null;
    llmAnthropicModel?: string | null;
    llmAnthropicOptIn?: boolean;
    llmGoogleApiKey?: string | null;
    llmGoogleModel?: string | null;
    llmGoogleOptIn?: boolean;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/admin/parser-settings", settings);
    return data;
  },

  /**
   * "Verbindung testen" for a cloud slot — sends only the key, no document.
   * `openai`/`anthropic`/`google` use their fixed base URL server-side;
   * `baseUrl` is only read (and required) for `kind: "custom"`.
   */
  testLlmProvider: async (input: {
    kind: CloudProviderKind;
    baseUrl?: string | null;
    model: string | null;
    apiKey: string | null;
  }): Promise<LlmProviderTestResult> => {
    const { data } = await api.post<LlmProviderTestResult>("/admin/test-llm-provider", input);
    return data;
  },

  testOllamaConnection: async (
    ollamaUrl: string,
    ollamaModel: string
  ): Promise<{
    success: boolean;
    models?: string[];
    warning?: string | null;
    error?: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      models?: string[];
      warning?: string | null;
      error?: string;
    }>("/admin/test-ollama", { ollamaUrl, ollamaModel });
    return data;
  },

  listOllamaModels: async (
    ollamaUrl: string
  ): Promise<{
    success: boolean;
    models?: Array<{ name: string; size: number; modified: string }>;
    error?: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      models?: Array<{ name: string; size: number; modified: string }>;
      error?: string;
    }>("/admin/ollama-models", { ollamaUrl });
    return data;
  },

  pullOllamaModel: async (
    ollamaUrl: string,
    modelName: string
  ): Promise<{ success: boolean; status?: string; error?: string }> => {
    const { data } = await api.post<{
      success: boolean;
      status?: string;
      error?: string;
    }>("/admin/ollama-pull", { ollamaUrl, modelName });
    return data;
  },

  getGlobalApiKeys: async (): Promise<{
    globalAirlabsApiKey?: string;
    globalAviationstackApiKey?: string;
    globalAerodataboxApiKey?: string;
    globalLogostreamApiKey?: string;
    globalOpenskyClientId?: string;
    globalOpenskyClientSecret?: string;
    globalOpenskyUsername?: string;
    globalOpenskyPassword?: string;
    // Tour routing provider (Phase 3): the global key each of the two
    // key-based providers falls back to when a user has none of their own,
    // and which provider/custom URL is active for the whole instance.
    globalOpenrouteserviceApiKey?: string;
    globalGraphhopperApiKey?: string;
    routingProvider: RoutingProviderId | null;
    routingCustomUrl: string | null;
    allowUserFlightApiKeys: boolean;
  }> => {
    const { data } = await api.get<{
      globalAirlabsApiKey?: string;
      globalAviationstackApiKey?: string;
      globalAerodataboxApiKey?: string;
      globalLogostreamApiKey?: string;
      globalOpenskyClientId?: string;
      globalOpenskyClientSecret?: string;
      globalOpenskyUsername?: string;
      globalOpenskyPassword?: string;
      globalOpenrouteserviceApiKey?: string;
      globalGraphhopperApiKey?: string;
      routingProvider: RoutingProviderId | null;
      routingCustomUrl: string | null;
      allowUserFlightApiKeys: boolean;
    }>("/admin/api-keys");
    return data;
  },

  updateGlobalApiKeys: async (keys: {
    globalAirlabsApiKey?: string | null;
    globalAviationstackApiKey?: string | null;
    globalAerodataboxApiKey?: string | null;
    globalLogostreamApiKey?: string | null;
    globalOpenskyClientId?: string | null;
    globalOpenskyClientSecret?: string | null;
    globalOpenskyUsername?: string | null;
    globalOpenskyPassword?: string | null;
    globalOpenrouteserviceApiKey?: string | null;
    globalGraphhopperApiKey?: string | null;
    routingProvider?: RoutingProviderId | null;
    routingCustomUrl?: string | null;
    allowUserFlightApiKeys?: boolean;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/admin/api-keys", keys);
    return data;
  },

  testApiKey: async (
    provider:
      | "openai"
      | "claude"
      | "airlabs"
      | "aviationstack"
      | "aerodatabox"
      | "opensky"
      | "openrouteservice"
      | "graphhopper"
      | "logostream"
      | "googlePlaces",
    apiKey?: string,
    openskyCredentials?: {
      clientId?: string;
      clientSecret?: string;
      username?: string;
      password?: string;
    }
  ): Promise<ApiKeyTestResponse> => {
    const endpoint = `/admin/api-keys/test/${provider}`;
    const payload = provider === "opensky" ? openskyCredentials : { apiKey };
    const { data } = await api.post<ApiKeyTestResponse>(endpoint, payload);
    return data;
  },

  // Logging API — every shape here is `shared/logContract.ts`, the file the
  // backend answers with. The two used to be described separately and drifted
  // (the cleanup toast read fields the server never sent).
  getLoggingConfig: async (): Promise<LoggingConfigResponse> => {
    const { data } = await api.get<LoggingConfigResponse>("/admin/logging/config");
    return data;
  },

  updateLoggingConfig: async (
    config: Partial<Omit<LoggingConfigResponse, "effectiveLogLevel" | "logLevelSource">>
  ): Promise<{ message: string; config: LoggingConfigResponse }> => {
    const { data } = await api.put<{ message: string; config: LoggingConfigResponse }>(
      "/admin/logging/config",
      config
    );
    return data;
  },

  toggleDebugLogging: async (
    enabled: boolean
  ): Promise<{ message: string; config: LoggingConfigResponse }> => {
    const { data } = await api.post<{ message: string; config: LoggingConfigResponse }>(
      "/admin/logging/toggle-debug",
      { enabled }
    );
    return data;
  },

  getLogFiles: async (): Promise<LogFilesResponse> => {
    const { data } = await api.get<LogFilesResponse>("/admin/logging/files");
    return data;
  },

  /** One page of a file, newest first. */
  readLogFile: async (
    filename: string,
    params: { level?: string; category?: string; search?: string; offset?: number; limit?: number }
  ): Promise<LogReadResponse> => {
    const { data } = await api.get<LogReadResponse>(
      `/admin/logging/files/${encodeURIComponent(filename)}`,
      { params }
    );
    return data;
  },

  downloadLogFile: async (filename: string): Promise<Blob> => {
    const response = await api.get<Blob>(
      `/admin/logging/files/${encodeURIComponent(filename)}/download`,
      { responseType: "blob" }
    );
    return response.data;
  },

  deleteLogFile: async (filename: string): Promise<MessageResponse> => {
    const { data } = await api.delete<MessageResponse>(
      `/admin/logging/files/${encodeURIComponent(filename)}`
    );
    return data;
  },

  getLogStats: async (): Promise<LogStatsResponse> => {
    const { data } = await api.get<LogStatsResponse>("/admin/logging/stats");
    return data;
  },

  cleanupLogs: async (): Promise<LogCleanupResult> => {
    const { data } = await api.post<LogCleanupResult>("/admin/logging/cleanup");
    return data;
  },

  getSmtpConfig: async (): Promise<SmtpConfigResponse> => {
    const { data } = await api.get<SmtpConfigResponse>("/admin/smtp");
    return data;
  },

  saveSmtpConfig: async (config: SmtpConfigInput): Promise<SmtpConfigResponse> => {
    const { data } = await api.put<SmtpConfigResponse>("/admin/smtp", config);
    return data;
  },

  deleteSmtpConfig: async (): Promise<SmtpConfigResponse> => {
    const { data } = await api.delete<SmtpConfigResponse>("/admin/smtp");
    return data;
  },

  testSmtpConnection: async (
    config: SmtpConfigInput
  ): Promise<{ success: boolean; error?: string }> => {
    const { data } = await api.post<{ success: boolean; error?: string }>(
      "/admin/smtp/test",
      config
    );
    return data;
  },

  adminResetPassword: async (
    userId: string,
    mode: "generate" | "set",
    password?: string,
    mustChangePassword?: boolean
  ): Promise<{ message: string; temporaryPassword?: string }> => {
    const { data } = await api.post<{ message: string; temporaryPassword?: string }>(
      `/admin/users/${userId}/reset-password`,
      { mode, password, mustChangePassword }
    );
    return data;
  },

  getInstanceSettings: async (): Promise<InstanceSettingsResponse> => {
    const { data } = await api.get<InstanceSettingsResponse>("/admin/instance-settings");
    return data;
  },

  updateInstanceSettings: async (
    patch: InstanceSettingsPatch
  ): Promise<InstanceSettingsResponse> => {
    const { data } = await api.put<InstanceSettingsResponse>("/admin/instance-settings", patch);
    return data;
  },

  /** Tests `url` (typed, not yet saved) or, without it, the saved URL. */
  testRailRouting: async (url?: string): Promise<RailRoutingTestResult> => {
    const { data } = await api.post<RailRoutingTestResult>(
      "/admin/instance-settings/rail-routing/test",
      url ? { url } : {}
    );
    return data;
  },

  getWebDAVSettings: async (): Promise<{
    settings: {
      enabled: boolean;
      url: string | null;
      username: string | null;
      passwordSet: boolean;
      backupPath: string;
    };
  }> => {
    const { data } = await api.get<{
      settings: {
        enabled: boolean;
        url: string | null;
        username: string | null;
        passwordSet: boolean;
        backupPath: string;
      };
    }>("/admin/webdav-settings");
    return data;
  },

  updateWebDAVSettings: async (patch: {
    enabled?: boolean;
    url?: string;
    username?: string;
    password?: string;
    backupPath?: string;
  }): Promise<{
    settings: {
      enabled: boolean;
      url: string | null;
      username: string | null;
      passwordSet: boolean;
      backupPath: string;
    };
  }> => {
    const { data } = await api.put<{
      settings: {
        enabled: boolean;
        url: string | null;
        username: string | null;
        passwordSet: boolean;
        backupPath: string;
      };
    }>("/admin/webdav-settings", patch);
    return data;
  },

  testWebDAVConnection: async (): Promise<{ success: boolean; message: string }> => {
    const { data } = await api.post<{ success: boolean; message: string }>(
      "/admin/webdav-settings/test"
    );
    return data;
  },
};
