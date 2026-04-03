import { api, hardwareApi } from "./client";
import type {
  ApiKeyTestResponse,
  ExportAllDataResponse,
  LogEntry,
  LogSearchResult,
  MessageResponse,
  ParserCorrectionPayload,
  ParserFeedbackEntry,
  SmtpConfigInput,
  SmtpConfigResponse,
  SuccessResponse,
} from "./types";

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
    }>("/admin/system/info");
    return data;
  },

  getHardwareInfo: async (): Promise<{
    cpu: {
      cores: number;
      model: string;
      architecture: string;
      error?: string;
    };
    gpu: {
      available: boolean;
      count?: number;
      name?: string;
      memory?: number;
      cudaVersion?: string;
      deviceId?: number;
      error?: string;
      reason?: string;
      diagnosis?: string[];
      pytorchHasCuda?: boolean;
      gpuDetected?: boolean;
      gpuNameDetected?: string;
      gpus?: Array<{
        id: number;
        name: string;
        memory: number;
      }>;
    };
    python: {
      available: boolean;
      version?: string;
      pytorch?: {
        available: boolean;
        version?: string;
      };
      error?: string;
    };
    docker: boolean;
    platform?: {
      system: string;
      release: string;
      version: string;
    };
    trainingAccess: {
      accessible: boolean;
      error?: string;
    };
  }> => {
    const { data } = await hardwareApi.get<{
      cpu: {
        cores: number;
        model: string;
        architecture: string;
        error?: string;
      };
      gpu: {
        available: boolean;
        count?: number;
        name?: string;
        memory?: number;
        cudaVersion?: string;
        deviceId?: number;
        error?: string;
        reason?: string;
        diagnosis?: string[];
        pytorchHasCuda?: boolean;
        gpuDetected?: boolean;
        gpuNameDetected?: string;
        gpus?: Array<{
          id: number;
          name: string;
          memory: number;
        }>;
      };
      python: {
        available: boolean;
        version?: string;
        pytorch?: {
          available: boolean;
          version?: string;
        };
        error?: string;
      };
      docker: boolean;
      platform?: {
        system: string;
        release: string;
        version: string;
      };
      trainingAccess: {
        accessible: boolean;
        error?: string;
      };
    }>("/admin/system/hardware");
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

  createInvitation: async (
    email?: string,
    expiresInDays: number = 7
  ): Promise<{
    invitation: {
      id: string;
      email?: string;
      token: string;
      expiresAt: string;
    };
    inviteUrl: string;
  }> => {
    const { data } = await api.post<{
      invitation: {
        id: string;
        email?: string;
        token: string;
        expiresAt: string;
      };
      inviteUrl: string;
    }>("/admin/invitations", { email, expiresInDays });
    return data;
  },

  getInvitations: async (): Promise<{
    invitations: Array<{
      id: string;
      email?: string;
      token: string;
      expiresAt: string;
      usedAt?: string;
      createdAt: string;
      creator: {
        username: string;
      };
    }>;
  }> => {
    const { data } = await api.get<{
      invitations: Array<{
        id: string;
        email?: string;
        token: string;
        expiresAt: string;
        usedAt?: string;
        createdAt: string;
        creator: {
          username: string;
        };
      }>;
    }>("/admin/invitations");
    return data;
  },

  exportAllData: async (): Promise<ExportAllDataResponse> => {
    const { data } = await api.get<ExportAllDataResponse>("/admin/export/all-data");
    return data;
  },

  getAdminParserSettings: async (): Promise<{
    globalOpenaiApiKey?: string;
    globalClaudeApiKey?: string;
    allowUserApiKeys: boolean;
    requireUserApiKeys: boolean;
    defaultVisionParser: string;
    defaultTextParser: string;
    ollamaUrl: string | null;
    ollamaModel: string | null;
    ollamaVisionModel: string | null;
  }> => {
    const { data } = await api.get<{
      globalOpenaiApiKey?: string;
      globalClaudeApiKey?: string;
      allowUserApiKeys: boolean;
      requireUserApiKeys: boolean;
      defaultVisionParser: string;
      defaultTextParser: string;
      ollamaUrl: string | null;
      ollamaModel: string | null;
      ollamaVisionModel: string | null;
    }>("/admin/parser-settings");
    return data;
  },

  updateAdminParserSettings: async (settings: {
    globalOpenaiApiKey?: string;
    globalClaudeApiKey?: string;
    allowUserApiKeys?: boolean;
    requireUserApiKeys?: boolean;
    defaultVisionParser?: string;
    defaultTextParser?: string;
    ollamaUrl?: string | null;
    ollamaModel?: string | null;
    ollamaVisionModel?: string | null;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/admin/parser-settings", settings);
    return data;
  },

  getTrainingConfig: async (): Promise<{
    trainingModelOutputDir: string | null;
    trainingEmailModelName: string | null;
    trainingVisionModelName: string | null;
    currentTrainingModelOutputDir: string;
    currentTrainingEmailModelName: string;
    currentTrainingVisionModelName: string;
    envTrainingModelOutputDir: string;
    envTrainingEmailModelName: string;
    envTrainingVisionModelName: string;
  }> => {
    const { data } = await api.get<{
      trainingModelOutputDir: string | null;
      trainingEmailModelName: string | null;
      trainingVisionModelName: string | null;
      currentTrainingModelOutputDir: string;
      currentTrainingEmailModelName: string;
      currentTrainingVisionModelName: string;
      envTrainingModelOutputDir: string;
      envTrainingEmailModelName: string;
      envTrainingVisionModelName: string;
    }>("/admin/training-config");
    return data;
  },

  updateTrainingConfig: async (config: {
    trainingModelOutputDir?: string | null;
    trainingEmailModelName?: string | null;
    trainingVisionModelName?: string | null;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/admin/training-config", config);
    return data;
  },

  getGlobalApiKeys: async (): Promise<{
    globalAirlabsApiKey?: string;
    globalAviationstackApiKey?: string;
    globalOpenskyClientId?: string;
    globalOpenskyClientSecret?: string;
    globalOpenskyUsername?: string;
    globalOpenskyPassword?: string;
    allowUserFlightApiKeys: boolean;
    requireUserFlightApiKeys: boolean;
  }> => {
    const { data } = await api.get<{
      globalAirlabsApiKey?: string;
      globalAviationstackApiKey?: string;
      globalOpenskyClientId?: string;
      globalOpenskyClientSecret?: string;
      globalOpenskyUsername?: string;
      globalOpenskyPassword?: string;
      allowUserFlightApiKeys: boolean;
      requireUserFlightApiKeys: boolean;
    }>("/admin/api-keys");
    return data;
  },

  updateGlobalApiKeys: async (keys: {
    globalAirlabsApiKey?: string | null;
    globalAviationstackApiKey?: string | null;
    globalOpenskyClientId?: string | null;
    globalOpenskyClientSecret?: string | null;
    globalOpenskyUsername?: string | null;
    globalOpenskyPassword?: string | null;
    allowUserFlightApiKeys?: boolean;
    requireUserFlightApiKeys?: boolean;
  }): Promise<MessageResponse> => {
    const { data } = await api.put<MessageResponse>("/admin/api-keys", keys);
    return data;
  },

  testApiKey: async (
    provider: "openai" | "claude" | "airlabs" | "aviationstack" | "opensky",
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

  // Parser Feedback API
  getParserFeedbackStats: async (params?: {
    provider?: string;
    sourceType?: "email" | "boardingpass";
    days?: number;
  }): Promise<{
    total: number;
    byProvider: Record<string, number>;
    bySourceType: Record<string, number>;
    avgQualityScore: number;
    commonIssues: Array<{ issue: string; count: number }>;
  }> => {
    const queryParams = new URLSearchParams();
    if (params?.provider) queryParams.append("provider", params.provider);
    if (params?.sourceType) queryParams.append("sourceType", params.sourceType);
    if (params?.days) queryParams.append("days", params.days.toString());

    const { data } = await api.get<{
      total: number;
      byProvider: Record<string, number>;
      bySourceType: Record<string, number>;
      avgQualityScore: number;
      commonIssues: Array<{ issue: string; count: number }>;
    }>(`/admin/parser-feedback/stats?${queryParams.toString()}`);
    return data;
  },

  submitParserCorrection: async (correction: ParserCorrectionPayload): Promise<SuccessResponse> => {
    const { data } = await api.post<SuccessResponse>("/parser-feedback/correction", correction);
    return data;
  },

  getParserPatterns: async (params?: {
    days?: number;
  }): Promise<{
    suggestions: Array<{
      pattern: string;
      field: string;
      confidence: number;
      examples: string[];
      issue: string;
    }>;
    summary: {
      totalIssues: number;
      suggestions: number;
      topIssues: Array<{ issue: string; count: number }>;
    };
    pendingSuggestions: Array<{
      pattern: string;
      field: string;
      confidence: number;
      examples: string[];
      issue: string;
    }>;
    stats: {
      total: number;
      applied: number;
      pending: number;
      avgConfidence: number;
      byField: Record<string, number>;
    };
  }> => {
    const queryParams = new URLSearchParams();
    if (params?.days) queryParams.append("days", params.days.toString());

    const { data } = await api.get<{
      suggestions: Array<{
        pattern: string;
        field: string;
        confidence: number;
        examples: string[];
        issue: string;
      }>;
      summary: {
        totalIssues: number;
        suggestions: number;
        topIssues: Array<{ issue: string; count: number }>;
      };
      pendingSuggestions: Array<{
        pattern: string;
        field: string;
        confidence: number;
        examples: string[];
        issue: string;
      }>;
      stats: {
        total: number;
        applied: number;
        pending: number;
        avgConfidence: number;
        byField: Record<string, number>;
      };
    }>(`/admin/parser-feedback/patterns?${queryParams.toString()}`);
    return data;
  },

  applyPatternSuggestion: async (
    patternId: string,
    autoApply?: boolean
  ): Promise<{
    success: boolean;
    message: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
    }>(`/admin/parser-feedback/patterns/${patternId}/apply`, { autoApply });
    return data;
  },

  autoApplyPatterns: async (
    threshold?: number
  ): Promise<{
    success: boolean;
    appliedCount: number;
    message: string;
  }> => {
    const { data } = await api.post<{
      success: boolean;
      appliedCount: number;
      message: string;
    }>("/admin/parser-feedback/patterns/auto-apply", { threshold });
    return data;
  },

  getParserFeedbackDetails: async (params?: {
    provider?: string;
    sourceType?: "email" | "boardingpass";
    days?: number;
    limit?: number;
    offset?: number;
  }): Promise<{
    feedback: ParserFeedbackEntry[];
    total: number;
  }> => {
    const queryParams = new URLSearchParams();
    if (params?.provider) queryParams.append("provider", params.provider);
    if (params?.sourceType) queryParams.append("sourceType", params.sourceType);
    if (params?.days) queryParams.append("days", params.days.toString());
    if (params?.limit) queryParams.append("limit", params.limit.toString());
    if (params?.offset) queryParams.append("offset", params.offset.toString());

    const { data } = await api.get<{
      feedback: ParserFeedbackEntry[];
      total: number;
    }>(`/admin/parser-feedback/details?${queryParams.toString()}`);
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
};
