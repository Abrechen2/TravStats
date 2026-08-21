import { api } from "./client";
import type {
  ApiKeyTestResponse,
  ExportAllDataResponse,
  LogEntry,
  LogSearchResult,
  MessageResponse,
  SmtpConfigInput,
  SmtpConfigResponse,
} from "./types";

export interface InstanceSettings {
  instanceName: string;
  maxUsers: number;
  allowRegistration: boolean;
  /** Instance-wide gate for unfinished features — see config/betaFeatures.ts. */
  betaFeaturesEnabled: boolean;
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
}

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
  frontendUrl?: string;
  publicUrl?: string;
  lanUrl?: string;
  webauthnRpId?: string;
  webauthnOrigins?: string[];
  // Empty string clears the DB override, reverting to ENV/default.
  photonUrl?: string;
  nominatimUrl?: string;
}

export const adminApi = {
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

  getAdminParserSettings: async (): Promise<{
    allowUserApiKeys: boolean;
    fxCdnFallbackEnabled: boolean;
    defaultVisionParser: string;
    defaultTextParser: string;
    ollamaUrl: string | null;
    ollamaModel: string | null;
  }> => {
    const { data } = await api.get<{
      allowUserApiKeys: boolean;
      fxCdnFallbackEnabled: boolean;
      defaultVisionParser: string;
      defaultTextParser: string;
      ollamaUrl: string | null;
      ollamaModel: string | null;
    }>("/admin/parser-settings");
    return data;
  },

  updateAdminParserSettings: async (settings: {
    allowUserApiKeys?: boolean;
    fxCdnFallbackEnabled?: boolean;
    ollamaUrl?: string | null;
    ollamaModel?: string | null;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/admin/parser-settings", settings);
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

  // Logging API
  getLoggingConfig: async (): Promise<{
    logLevel: string;
    logHttpRequests: boolean;
    logDatabaseQueries: boolean;
    logParserOperations: boolean;
    maxLogFileSize: number;
    logRetentionDays: number;
  }> => {
    const { data } = await api.get<{
      logLevel: string;
      logHttpRequests: boolean;
      logDatabaseQueries: boolean;
      logParserOperations: boolean;
      maxLogFileSize: number;
      logRetentionDays: number;
    }>("/admin/logging/config");
    return data;
  },

  updateLoggingConfig: async (config: {
    logLevel?: string;
    logHttpRequests?: boolean;
    logDatabaseQueries?: boolean;
    logParserOperations?: boolean;
    maxLogFileSize?: number;
    logRetentionDays?: number;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/admin/logging/config", config);
    return data;
  },

  toggleDebugLogging: async (
    enabled: boolean
  ): Promise<{
    enabled: boolean;
    message: string;
  }> => {
    const { data } = await api.post<{
      enabled: boolean;
      message: string;
    }>("/admin/logging/toggle-debug", { enabled });
    return data;
  },

  getLogFiles: async (): Promise<{
    files: Array<{
      filename: string;
      size: number;
      category: string;
      created: string;
      modified: string;
    }>;
  }> => {
    const { data } = await api.get<{
      files: Array<{
        filename: string;
        size: number;
        category: string;
        created: string;
        modified: string;
      }>;
    }>("/admin/logging/files");
    return data;
  },

  getLogFileContent: async (
    filename: string,
    params?: {
      level?: string;
      category?: string;
      search?: string;
      offset?: number;
      limit?: number;
    }
  ): Promise<{
    logs: LogEntry[];
    total: number;
    offset: number;
    limit: number;
  }> => {
    const { data } = await api.get<{
      logs: LogEntry[];
      total: number;
      offset: number;
      limit: number;
    }>(`/admin/logging/files/${filename}`, { params });
    return data;
  },

  downloadLogFile: async (filename: string): Promise<Blob> => {
    const response = await api.get<Blob>(`/admin/logging/files/${filename}/download`, {
      responseType: "blob",
    });
    return response.data;
  },

  deleteLogFile: async (filename: string): Promise<MessageResponse> => {
    const { data } = await api.delete<MessageResponse>(`/admin/logging/files/${filename}`);
    return data;
  },

  getLogStats: async (): Promise<{
    totalSize: number;
    fileCount: number;
    categories: Record<string, { fileCount: number; totalSize: number }>;
    oldestLog: string;
    newestLog: string;
  }> => {
    const { data } = await api.get<{
      totalSize: number;
      fileCount: number;
      categories: Record<string, { fileCount: number; totalSize: number }>;
      oldestLog: string;
      newestLog: string;
    }>("/admin/logging/stats");
    return data;
  },

  cleanupLogs: async (): Promise<{
    message: string;
    filesDeleted: number;
    spaceFreed: number;
  }> => {
    const { data } = await api.post<{
      message: string;
      filesDeleted: number;
      spaceFreed: number;
    }>("/admin/logging/cleanup");
    return data;
  },

  searchLogs: async (params: {
    query: string;
    level?: string;
    category?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }): Promise<{
    results: LogSearchResult[];
    total: number;
  }> => {
    const { data } = await api.get<{
      results: LogSearchResult[];
      total: number;
    }>("/admin/logging/search", { params });
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
