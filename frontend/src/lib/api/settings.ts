import { api } from "./client";
import type {
  ApiKeyTestResponse,
  MessageResponse,
  NotificationPreferences,
  SmtpConfigInput,
  SmtpConfigResponse,
  UserSettings,
} from "./types";

/**
 * Per-provider quota indicator. Backend returns one of three kinds depending
 * on what the upstream provider exposes:
 *   - `observed` — live numbers from response headers (AeroDataBox today)
 *   - `not_reported` — provider doesn't expose quota; we may know a static
 *     monthly cap (e.g. AirLabs free 1000) but not the current count
 *   - `rate_limit_only` — IP-based per-second throttling, no monthly quota
 *     (OpenSky)
 */
export type ProviderQuota =
  | {
      kind: "observed";
      /** Primary tier quota (AeroDataBox BASIC: 600/month).
       *  Always prefer this over `requestsLimit` for user-facing budgeting. */
      limit: number | null;
      remaining: number | null;
      /** Secondary HTTP-request counter (RapidAPI BASIC: ~2400/month).
       *  Shown as supplementary detail only — not the plan budget. */
      requestsLimit?: number | null;
      requestsRemaining?: number | null;
      observedAt: string;
    }
  | { kind: "not_reported"; knownLimitHint?: number }
  | { kind: "rate_limit_only" };

export type ApiProvider = "aerodatabox" | "airlabs" | "aviationstack" | "opensky";

export type ApiKeyQuotasResponse = Record<ApiProvider, ProviderQuota>;

export interface HomeAirportEntry {
  iata: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string | null; // YYYY-MM-DD, null = currently active
}

// Settings API
export const settingsApi = {
  get: async (): Promise<UserSettings> => {
    const { data } = await api.get<UserSettings>("/settings");
    return data;
  },
  update: async (payload: Partial<UserSettings>): Promise<UserSettings> => {
    const { data } = await api.put<UserSettings>("/settings", payload);
    return data;
  },
  getParserSettings: async (): Promise<{
    visionProvider?: string;
    textProvider?: string;
  }> => {
    const { data } = await api.get<{
      visionProvider?: string;
      textProvider?: string;
    }>("/settings/parser");
    return data;
  },
  updateParserSettings: async (): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/settings/parser", {});
    return data;
  },
  getTrainingSettings: async (): Promise<{
    useTrainedModels: boolean;
    preferredEmailModel: "auto" | "trained" | "base";
    preferredVisionModel: "auto" | "trained" | "base";
    trainingSeparateModels: boolean;
  }> => {
    const { data } = await api.get<{
      useTrainedModels: boolean;
      preferredEmailModel: "auto" | "trained" | "base";
      preferredVisionModel: "auto" | "trained" | "base";
      trainingSeparateModels: boolean;
    }>("/settings/training");
    return data;
  },
  updateTrainingSettings: async (payload: {
    useTrainedModels?: boolean;
    preferredEmailModel?: "auto" | "trained" | "base";
    preferredVisionModel?: "auto" | "trained" | "base";
    trainingSeparateModels?: boolean;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/settings/training", payload);
    return data;
  },
  // User-level profile fields that don't live inside the UserSettings JSON
  // (birthdate etc.). Backed by /settings/profile — separate from the
  // `profile` entry on UserSettings which only carries username / email /
  // avatar URL.
  getProfile: async (): Promise<{ birthdate: string | null }> => {
    const { data } = await api.get<{ birthdate: string | null }>("/settings/profile");
    return data;
  },
  updateProfile: async (payload: {
    birthdate: string | null;
  }): Promise<{ birthdate: string | null }> => {
    const { data } = await api.put<{ birthdate: string | null }>("/settings/profile", payload);
    return data;
  },
  uploadProfilePicture: async (file: File): Promise<{ profilePictureUrl: string }> => {
    const formData = new FormData();
    formData.append("profilePicture", file);
    const { data } = await api.post<{ profilePictureUrl: string }>(
      "/settings/profile-picture",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );
    return data;
  },
  deleteProfilePicture: async (): Promise<void> => {
    await api.delete("/settings/profile-picture");
  },
  getHomeAirports: async (): Promise<{ history: HomeAirportEntry[] }> => {
    const { data } = await api.get<{ history: HomeAirportEntry[] }>("/settings/home-airports");
    return data;
  },
  setHomeAirport: async (payload: {
    iata: string;
    fromDate?: string;
  }): Promise<{ history: HomeAirportEntry[] }> => {
    const { data } = await api.post<{ history: HomeAirportEntry[] }>(
      "/settings/home-airports",
      payload
    );
    return data;
  },
  updateHomeAirport: async (
    index: number,
    patch: Partial<HomeAirportEntry>
  ): Promise<{ history: HomeAirportEntry[] }> => {
    const { data } = await api.patch<{ history: HomeAirportEntry[] }>(
      `/settings/home-airports/${index}`,
      patch
    );
    return data;
  },
  deleteHomeAirport: async (index: number): Promise<{ history: HomeAirportEntry[] }> => {
    const { data } = await api.delete<{ history: HomeAirportEntry[] }>(
      `/settings/home-airports/${index}`
    );
    return data;
  },
  getApiKeys: async (): Promise<{
    airlabs: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    aviationstack: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    aerodatabox: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    opensky: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    // Tour routing provider keys (Phase 3) — a user's own key takes
    // precedence over the admin's global one; see `apiKeyResolver.getApiKey`.
    openrouteservice: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    graphhopper: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
  }> => {
    const { data } = await api.get<{
      airlabs: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
      aviationstack: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
      aerodatabox: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
      opensky: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
      openrouteservice: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
      graphhopper: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    }>("/settings/api-keys");
    return data;
  },
  getApiKeyQuotas: async (): Promise<ApiKeyQuotasResponse> => {
    const { data } = await api.get<ApiKeyQuotasResponse>("/settings/api-keys/quota");
    return data;
  },
  updateApiKeys: async (payload: {
    airlabsApiKey?: string | null;
    aviationstackApiKey?: string | null;
    aerodataboxApiKey?: string | null;
    openskyClientId?: string | null;
    openskyClientSecret?: string | null;
    openskyUsername?: string | null;
    openskyPassword?: string | null;
    openrouteserviceApiKey?: string | null;
    graphhopperApiKey?: string | null;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/settings/api-keys", payload);
    return data;
  },
  testApiKey: async (
    provider: "airlabs" | "aviationstack" | "aerodatabox" | "opensky" | "openrouteservice" | "graphhopper",
    apiKey?: string,
    openskyCredentials?: {
      clientId?: string;
      clientSecret?: string;
      username?: string;
      password?: string;
    }
  ): Promise<ApiKeyTestResponse> => {
    const endpoint = `/settings/api-keys/test/${provider}`;
    const payload = provider === "opensky" ? openskyCredentials : { apiKey };
    const { data } = await api.post<ApiKeyTestResponse>(endpoint, payload);
    return data;
  },
  getNotificationPreferences: async (): Promise<NotificationPreferences> => {
    const { data } = await api.get<NotificationPreferences>("/settings/notifications");
    return data;
  },
  updateNotificationPreferences: async (
    prefs: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> => {
    const { data } = await api.put<NotificationPreferences>("/settings/notifications", prefs);
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
  testSmtpConnection: async (
    config: SmtpConfigInput
  ): Promise<{ success: boolean; error?: string }> => {
    const { data } = await api.post<{ success: boolean; error?: string }>(
      "/admin/smtp/test",
      config
    );
    return data;
  },
};
