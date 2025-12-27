import axios from 'axios';
import type {
  User,
  Flight,
  FlightInput,
  FlightFilters,
  Stats,
  Route,
  GeoJSONFeatureCollection,
  AchievementsResponse,
  UserAchievement,
  LeaderboardEntry,
  FlightLookupResult,
  OnboardingState
} from '../types';

import { API_TIMEOUTS } from '../config/constants';

export const API_URL = (import.meta as any).env?.VITE_API_URL || '';

// Standard API instance with 10s timeout for normal requests
const api = axios.create({
  baseURL: API_URL ? `${API_URL}/api/v1` : '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: API_TIMEOUTS.DEFAULT,
  withCredentials: true, // Send cookies with every request (HttpOnly JWT)
});

// Parser API instance with 180s timeout for long-running parser operations
const parserApi = axios.create({
  baseURL: API_URL ? `${API_URL}/api/v1` : '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: API_TIMEOUTS.PARSER,
  withCredentials: true,
});

// Hardware API instance with 35s timeout for hardware info operations
const hardwareApi = axios.create({
  baseURL: API_URL ? `${API_URL}/api/v1` : '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: API_TIMEOUTS.HARDWARE,
  withCredentials: true,
});

// Response interceptor for handling 401 errors (expired/invalid tokens)
// Uses event-based approach to avoid circular dependencies
const handle401Error = (error: any) => {
  if (error.response?.status === 401) {
    // Token expired or invalid - dispatch event for auth store to handle
    // This avoids circular dependency between api.ts and authStore.ts
    const event = new CustomEvent('auth:unauthorized', {
      detail: { error },
    });
    window.dispatchEvent(event);

    // Fallback: only redirect if the app didn't clear the persisted user state.
    // In normal flow, authStore will logout (clears user) and route guards will navigate.
    setTimeout(() => {
      try {
        const publicPaths = new Set(['/login', '/register', '/setup']);
        if (publicPaths.has(window.location.pathname)) return;

        const raw = localStorage.getItem('auth-storage');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const hasUser = !!parsed?.state?.user;
        if (hasUser) {
          window.location.href = '/login';
        }
      } catch {
        window.location.href = '/login';
      }
    }, 200);
  }
  return Promise.reject(error);
};

api.interceptors.response.use(
  (response) => response,
  handle401Error
);

parserApi.interceptors.response.use(
  (response) => response,
  handle401Error
);

hardwareApi.interceptors.response.use(
  (response) => response,
  handle401Error
);

// Auth API
export const authApi = {
  register: async (username: string, password: string) => {
    const { data } = await api.post<{ user: User }>('/auth/register', {
      username,
      password,
    });
    return data;
  },

  login: async (username: string, password: string) => {
    const { data } = await api.post<{ user: User }>('/auth/login', {
      username,
      password,
    });
    return data;
  },

  logout: async () => {
    await api.post('/auth/logout');
  },
  changePassword: async (oldPassword: string, newPassword: string) => {
    const { data } = await api.post<{ message: string }>('/auth/change-password', {
      oldPassword,
      newPassword,
    });
    return data;
  },
};

// Parse API (Email & Boarding Pass) - Uses parserApi with 180s timeout
export const parseApi = {
  parseEmail: async (emailContent: string, subject?: string) => {
    const { data } = await parserApi.post('/parse-email', {
      emailContent,
      subject,
    });
    return data;
  },

  parseEmailFile: async (file: File) => {
    const formData = new FormData();
    formData.append('email', file);

    const { data } = await parserApi.post('/parse-email-file', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return data;
  },

  parseBoardingpass: async (imageBase64: string, enrichWithApi = true) => {
    const { data } = await parserApi.post('/parse-boardingpass', {
      imageBase64,
      enrichWithApi,
    });
    return data;
  },

  checkOllamaVision: async () => {
    const { data } = await parserApi.get('/parse-boardingpass/check');
    return data;
  },

  // Get available parser providers
  getProviders: async () => {
    const { data } = await parserApi.get<{
      vision: Array<{
        provider: string;
        availability: {
          available: boolean;
          reason?: string;
          metadata?: Record<string, any>;
        };
      }>;
      text: Array<{
        provider: string;
        availability: {
          available: boolean;
          reason?: string;
          metadata?: Record<string, any>;
        };
      }>;
    }>('/parse-boardingpass/providers');
    return data;
  },

  submitParserCorrection: async (correction: {
    sourceType: 'email' | 'boardingpass';
    provider: string;
    originalResult: any[];
    correctedResult: any[];
    originalData?: {
      subject?: string;
      text?: string;
      html?: string;
    };
  }) => {
    const { data } = await api.post('/parser-feedback/correction', correction);
    return data;
  },
};

// Flights API
export const flightsApi = {
  getAll: async (filters?: FlightFilters) => {
    const { data } = await api.get<{
      flights: Flight[];
      total: number;
      limit: number;
      offset: number;
    }>('/flights', { params: filters });
    return data;
  },

  getGeoJSON: async (filters?: FlightFilters) => {
    const { data } = await api.get<GeoJSONFeatureCollection>('/flights/geo', {
      params: filters,
    });
    return data;
  },

  getById: async (id: string) => {
    const { data } = await api.get<Flight>(`/flights/${id}`);
    return data;
  },

  create: async (flight: FlightInput) => {
    const { data } = await api.post<Flight>('/flights', flight);
    return data;
  },

  update: async (id: string, flight: Partial<FlightInput>) => {
    const { data } = await api.put<Flight>(`/flights/${id}`, flight);
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/flights/${id}`);
  },

  lookup: async (params: { flightNumber: string; date?: string }) => {
    const { data } = await api.get<FlightLookupResult>('/flights/lookup', { params });
    return data;
  },
};

// Stats API
export const statsApi = {
  getSummary: async (filters?: { fromDate?: string; toDate?: string }) => {
    const { data } = await api.get<Stats>('/stats/summary', { params: filters });
    return data;
  },

  getTopRoutes: async (limit = 10) => {
    const { data } = await api.get<{ routes: Route[] }>('/stats/routes', {
      params: { limit },
    });
    return data;
  },

  getFunStats: async (filters?: { fromDate?: string; toDate?: string }) => {
    const { data } = await api.get<import('../types').FunStats>('/stats/fun', { params: filters });
    return data;
  },

  getBusinessStats: async (filters?: { fromDate?: string; toDate?: string }) => {
    const { data } = await api.get<import('../types').BusinessStats>('/stats/business', { params: filters });
    return data;
  },

  getUniqueStats: async (filters?: { fromDate?: string; toDate?: string }) => {
    const { data } = await api.get<import('../types').UniqueStats>('/stats/unique', { params: filters });
    return data;
  },
};

// Airport API
export interface Airport {
  id?: number;
  iata?: string;
  icao?: string;
  name: string;
  city?: string;
  country?: string;
  lat: number;
  lon: number;
  altitude?: number;
  timezone?: string;
}

export const airportsApi = {
  search: async (query: string): Promise<Airport[]> => {
    const { data } = await api.get<Airport[]>('/airports/search', {
      params: { q: query },
    });
    return data;
  },

  getByCode: async (code: string): Promise<Airport> => {
    const { data } = await api.get<Airport>(`/airports/${code}`);
    return data;
  },
};

// Achievements API
export const achievementsApi = {
  getAll: async () => {
    const { data } = await api.get<AchievementsResponse>('/achievements');
    return data;
  },

  getRecent: async (limit = 10) => {
    const { data } = await api.get<{ achievements: UserAchievement[] }>(
      '/achievements/recent',
      { params: { limit } }
    );
    return data;
  },

  checkAchievements: async () => {
    const { data } = await api.post<{
      message: string;
      newlyUnlocked: number;
      achievements: UserAchievement[];
    }>('/achievements/check');
    return data;
  },

  getLeaderboard: async (limit = 10) => {
    const { data } = await api.get<{ leaderboard: LeaderboardEntry[] }>(
      '/achievements/leaderboard',
      { params: { limit } }
    );
    return data;
  },
};

// Settings API
export const settingsApi = {
  get: async () => {
    const { data } = await api.get('/settings');
    return data;
  },
  update: async (payload: any) => {
    const { data } = await api.put('/settings', payload);
    return data;
  },
  getParserSettings: async () => {
    const { data } = await api.get<{
      preferredVisionParser?: string;
      preferredTextParser?: string;
      visionFallbackChain?: string;
      textFallbackChain?: string;
      openaiApiKey?: string;
      claudeApiKey?: string;
    }>('/settings/parser');
    return data;
  },
  updateParserSettings: async (payload: {
    preferredVisionParser?: string;
    preferredTextParser?: string;
    visionFallbackChain?: string;
    textFallbackChain?: string;
    openaiApiKey?: string;
    claudeApiKey?: string;
  }) => {
    const { data } = await api.put('/settings/parser', payload);
    return data;
  },
  getDeveloperMode: async () => {
    const { data } = await api.get<{
      enabled: boolean;
      confirmedAt: string | null;
    }>('/settings/developer-mode');
    return data;
  },
  updateDeveloperMode: async (payload: { enabled: boolean; confirmed?: boolean }) => {
    const { data } = await api.put('/settings/developer-mode', payload);
    return data;
  },
  getTrainingSettings: async () => {
    const { data } = await api.get<{
      useTrainedModels: boolean;
      preferredEmailModel: 'auto' | 'trained' | 'base';
      preferredVisionModel: 'auto' | 'trained' | 'base';
      trainingSeparateModels: boolean;
    }>('/settings/training');
    return data;
  },
  updateTrainingSettings: async (payload: {
    useTrainedModels?: boolean;
    preferredEmailModel?: 'auto' | 'trained' | 'base';
    preferredVisionModel?: 'auto' | 'trained' | 'base';
    trainingSeparateModels?: boolean;
  }) => {
    const { data } = await api.put('/settings/training', payload);
    return data;
  },
  uploadProfilePicture: async (file: File) => {
    const formData = new FormData();
    formData.append('profilePicture', file);
    const { data } = await api.post<{ profilePictureUrl: string }>('/settings/profile-picture', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return data;
  },
  getOnboardingState: async () => {
    const { data } = await api.get<OnboardingState>('/settings/onboarding-state');
    return data;
  },
  updateOnboardingState: async (state: OnboardingState) => {
    const { data } = await api.put<OnboardingState>('/settings/onboarding-state', state);
    return data;
  },
  getApiKeys: async () => {
    const { data } = await api.get<{
      openai: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
      claude: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
      airlabs: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
      aviationstack: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
      opensky: { hasKey: boolean; isShared: boolean; hasAccess: boolean };
    }>('/settings/api-keys');
    return data;
  },
  updateApiKeys: async (payload: {
    openaiApiKey?: string | null;
    claudeApiKey?: string | null;
    airlabsApiKey?: string | null;
    aviationstackApiKey?: string | null;
    openskyClientId?: string | null;
    openskyClientSecret?: string | null;
    openskyUsername?: string | null;
    openskyPassword?: string | null;
  }) => {
    const { data } = await api.put('/settings/api-keys', payload);
    return data;
  },
  testApiKey: async (provider: 'openai' | 'claude' | 'airlabs' | 'aviationstack' | 'opensky', apiKey?: string, openskyCredentials?: { clientId?: string; clientSecret?: string; username?: string; password?: string }) => {
    const endpoint = `/settings/api-keys/test/${provider}`;
    const payload = provider === 'opensky' ? openskyCredentials : { apiKey };
    const { data } = await api.post<{ success: boolean; message: string; details?: any }>(endpoint, payload);
    return data;
  },
};

// Analytics API
export const analyticsApi = {
  track: async (type: string, payload?: Record<string, any>) => {
    await api.post('/analytics/events', { type, payload });
  },
};

// Training API
export const trainingApi = {
  upload: async (file: File, type: 'email' | 'boarding_pass') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    const { data } = await api.post('/training/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return data;
  },
  annotate: async (id: string, annotations: any, extractedData: any[], tags?: string[]) => {
    const { data } = await api.post(`/training/${id}/annotate`, {
      annotations,
      extractedData,
      tags: tags || [],
    });
    return data;
  },
  saveAndTrain: async (id: string, annotations: any, extractedData: any[], tags?: string[]) => {
    const { data } = await api.post(`/training/${id}/save-and-train`, {
      annotations,
      extractedData,
      tags: tags || [],
    });
    return data;
  },
  trainOnly: async (id: string) => {
    const { data } = await api.post(`/training/${id}/train-only`);
    return data;
  },
  getById: async (id: string) => {
    const { data } = await api.get(`/training/${id}`);
    return data;
  },
  getData: async (queryString?: string) => {
    const url = `/training/data${queryString ? `?${queryString}` : ''}`;
    const { data } = await api.get<{ trainingData: any[] }>(url);
    return data;
  },
  getJobs: async () => {
    const { data } = await api.get<{ jobs: any[] }>('/training/jobs');
    return data;
  },
  getJobLogs: async (jobId: string) => {
    const { data } = await api.get(`/training/jobs/${jobId}/logs`);
    return data;
  },
  triggerTraining: async () => {
    const { data } = await api.post<{ trainingJobId: string; message: string }>('/training/trigger');
    return data;
  },
  cancelTraining: async (jobId: string) => {
    const { data } = await api.post<{ message: string }>(`/training/jobs/${jobId}/cancel`);
    return data;
  },
  deleteTrainingData: async (id: string) => {
    const { data } = await api.delete(`/training/${id}`);
    return data;
  },
};

// Upload API
export const uploadsApi = {
  uploadReceipt: async (file: File, onProgress?: (progress: number) => void): Promise<string> => {
    const formData = new FormData();
    formData.append('receipt', file);

    const { data } = await api.post<{ receiptUrl: string; filename: string; size: number; mimetype: string }>(
      '/uploads/receipt',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(progress);
          }
        },
      }
    );

    return data.receiptUrl;
  },

  deleteReceipt: async (filename: string): Promise<void> => {
    await api.delete(`/uploads/receipts/${filename}`);
  },
};

// Setup API
export const setupApi = {
  getStatus: async () => {
    const { data } = await api.get<{
      setupComplete: boolean;
      requiresSetup: boolean;
      message: string;
    }>('/setup/status');
    return data;
  },

  initialize: async (username: string, password: string, instanceName?: string) => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
      user: { id: string; username: string; isAdmin: boolean };
    }>('/setup/initialize', {
      username,
      password,
      instanceName,
    });
    return data;
  },

  getAirportSeedingStatus: async () => {
    const { data } = await api.get<{
      status: 'pending' | 'running' | 'completed' | 'failed';
      progress?: number; // 0-1
      estimatedSecondsRemaining?: number;
      totalAirports?: number;
      processedAirports?: number;
      error?: string;
    }>('/setup/airport-seeding-status');
    return data;
  },
};

export const adminApi = {
  getSystemInfo: async () => {
    const { data } = await api.get<{
      instanceName: string;
      userCount: number;
      activeUserCount: number;
      flightCount: number;
      maxUsers: number;
      warningThreshold: boolean;
      registrationEnabled: boolean;
      version: string;
    }>('/admin/system/info');
    return data;
  },

  getHardwareInfo: async () => {
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
    }>('/admin/system/hardware');
    return data;
  },

  getUsers: async () => {
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
    }>('/admin/users');
    return data;
  },

  toggleUserActive: async (userId: string) => {
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

  createInvitation: async (email?: string, expiresInDays: number = 7) => {
    const { data } = await api.post<{
      invitation: {
        id: string;
        email?: string;
        token: string;
        expiresAt: string;
      };
      inviteUrl: string;
    }>('/admin/invitations', { email, expiresInDays });
    return data;
  },

  getInvitations: async () => {
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
    }>('/admin/invitations');
    return data;
  },

  exportAllData: async () => {
    const { data } = await api.get('/admin/export/all-data');
    return data;
  },

  getAdminParserSettings: async () => {
    const { data } = await api.get<{
      globalOpenaiApiKey?: string;
      globalClaudeApiKey?: string;
      allowUserApiKeys: boolean;
      requireUserApiKeys: boolean;
      defaultVisionParser: string;
      defaultTextParser: string;
    }>('/admin/parser-settings');
    return data;
  },

  updateAdminParserSettings: async (settings: {
    globalOpenaiApiKey?: string;
    globalClaudeApiKey?: string;
    allowUserApiKeys?: boolean;
    requireUserApiKeys?: boolean;
    defaultVisionParser?: string;
    defaultTextParser?: string;
  }) => {
    const { data } = await api.put('/admin/parser-settings', settings);
    return data;
  },

  getTrainingConfig: async () => {
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
    }>('/admin/training-config');
    return data;
  },

  updateTrainingConfig: async (config: {
    trainingModelOutputDir?: string | null;
    trainingEmailModelName?: string | null;
    trainingVisionModelName?: string | null;
  }) => {
    const { data } = await api.put('/admin/training-config', config);
    return data;
  },

  getGlobalApiKeys: async () => {
    const { data } = await api.get<{
      globalAirlabsApiKey?: string;
      globalAviationstackApiKey?: string;
      globalOpenskyClientId?: string;
      globalOpenskyClientSecret?: string;
      globalOpenskyUsername?: string;
      globalOpenskyPassword?: string;
      allowUserFlightApiKeys: boolean;
      requireUserFlightApiKeys: boolean;
    }>('/admin/api-keys');
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
  }) => {
    const { data } = await api.put('/admin/api-keys', keys);
    return data;
  },
  testApiKey: async (provider: 'openai' | 'claude' | 'airlabs' | 'aviationstack' | 'opensky', apiKey?: string, openskyCredentials?: { clientId?: string; clientSecret?: string; username?: string; password?: string }) => {
    const endpoint = `/admin/api-keys/test/${provider}`;
    const payload = provider === 'opensky' ? openskyCredentials : { apiKey };
    const { data } = await api.post<{ success: boolean; message: string; details?: any }>(endpoint, payload);
    return data;
  },

  // Logging API
  getLoggingConfig: async () => {
    const { data } = await api.get<{
      logLevel: string;
      logHttpRequests: boolean;
      logDatabaseQueries: boolean;
      logParserOperations: boolean;
      maxLogFileSize: number;
      logRetentionDays: number;
    }>('/admin/logging/config');
    return data;
  },

  updateLoggingConfig: async (config: {
    logLevel?: string;
    logHttpRequests?: boolean;
    logDatabaseQueries?: boolean;
    logParserOperations?: boolean;
    maxLogFileSize?: number;
    logRetentionDays?: number;
  }) => {
    const { data } = await api.put('/admin/logging/config', config);
    return data;
  },

  toggleDebugLogging: async (enabled: boolean) => {
    const { data } = await api.post<{
      enabled: boolean;
      message: string;
    }>('/admin/logging/toggle-debug', { enabled });
    return data;
  },

  getLogFiles: async () => {
    const { data } = await api.get<{
      files: Array<{
        filename: string;
        size: number;
        category: string;
        created: string;
        modified: string;
      }>;
    }>('/admin/logging/files');
    return data;
  },

  // Parser Feedback API
  getParserFeedbackStats: async (params?: {
    provider?: string;
    sourceType?: 'email' | 'boardingpass';
    days?: number;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.provider) queryParams.append('provider', params.provider);
    if (params?.sourceType) queryParams.append('sourceType', params.sourceType);
    if (params?.days) queryParams.append('days', params.days.toString());

    const { data } = await api.get<{
      total: number;
      byProvider: Record<string, number>;
      bySourceType: Record<string, number>;
      avgQualityScore: number;
      commonIssues: Array<{ issue: string; count: number }>;
    }>(`/admin/parser-feedback/stats?${queryParams.toString()}`);
    return data;
  },

  submitParserCorrection: async (correction: {
    sourceType: 'email' | 'boardingpass';
    provider: string;
    originalResult: any[];
    correctedResult: any[];
    originalData?: {
      subject?: string;
      text?: string;
      html?: string;
    };
  }) => {
    const { data } = await api.post('/parser-feedback/correction', correction);
    return data;
  },

  getParserPatterns: async (params?: { days?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.days) queryParams.append('days', params.days.toString());

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

  applyPatternSuggestion: async (patternId: string, autoApply?: boolean) => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
    }>(`/admin/parser-feedback/patterns/${patternId}/apply`, { autoApply });
    return data;
  },

  autoApplyPatterns: async (threshold?: number) => {
    const { data } = await api.post<{
      success: boolean;
      appliedCount: number;
      message: string;
    }>('/admin/parser-feedback/patterns/auto-apply', { threshold });
    return data;
  },

  getParserFeedbackDetails: async (params?: {
    provider?: string;
    sourceType?: 'email' | 'boardingpass';
    days?: number;
    limit?: number;
    offset?: number;
  }) => {
    const queryParams = new URLSearchParams();
    if (params?.provider) queryParams.append('provider', params.provider);
    if (params?.sourceType) queryParams.append('sourceType', params.sourceType);
    if (params?.days) queryParams.append('days', params.days.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const { data } = await api.get<{
      feedback: Array<{
        id: string;
        userId: string;
        createdAt: string;
        payload: any;
      }>;
      total: number;
    }>(`/admin/parser-feedback/details?${queryParams.toString()}`);
    return data;
  },

  getLogFileContent: async (filename: string, params?: {
    level?: string;
    category?: string;
    search?: string;
    offset?: number;
    limit?: number;
  }) => {
    const { data } = await api.get<{
      logs: Array<{
        timestamp: string;
        level: string;
        category: string;
        message: string;
        context?: any;
        performance?: any;
        requestId?: string;
        error?: any;
      }>;
      total: number;
      offset: number;
      limit: number;
    }>(`/admin/logging/files/${filename}`, { params });
    return data;
  },

  downloadLogFile: async (filename: string) => {
    const response = await api.get(`/admin/logging/files/${filename}/download`, {
      responseType: 'blob',
    });
    return response.data;
  },

  deleteLogFile: async (filename: string) => {
    const { data } = await api.delete(`/admin/logging/files/${filename}`);
    return data;
  },

  getLogStats: async () => {
    const { data } = await api.get<{
      totalSize: number;
      fileCount: number;
      categories: Record<string, { fileCount: number; totalSize: number }>;
      oldestLog: string;
      newestLog: string;
    }>('/admin/logging/stats');
    return data;
  },

  cleanupLogs: async () => {
    const { data } = await api.post<{
      message: string;
      filesDeleted: number;
      spaceFreed: number;
    }>('/admin/logging/cleanup');
    return data;
  },

  searchLogs: async (params: {
    query: string;
    level?: string;
    category?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }) => {
    const { data } = await api.get<{
      results: Array<{
        filename: string;
        timestamp: string;
        level: string;
        category: string;
        message: string;
        context?: any;
      }>;
      total: number;
    }>('/admin/logging/search', { params });
    return data;
  },
};

// Pending Updates API
export const pendingUpdatesApi = {
  getAll: async (filters?: { status?: string; flightId?: string }) => {
    const { data } = await api.get<{
      updates: any[];
      count: number;
    }>('/pending-updates', { params: filters });
    return data;
  },

  getById: async (id: string) => {
    const { data } = await api.get<any>(`/pending-updates/${id}`);
    return data;
  },

  getStatistics: async () => {
    const { data } = await api.get<{
      totalUpdates: number;
      appliedUpdates: number;
      rejectedUpdates: number;
      editedUpdates: number;
      expiredUpdates: number;
      mostChangedFields: Record<string, number>;
      averageUpdateTime: number | null;
    }>('/pending-updates/statistics');
    return data;
  },

  update: async (id: string, editedData: any) => {
    const { data } = await api.put<any>(`/pending-updates/${id}`, { editedData });
    return data;
  },

  preview: async (id: string, editedData?: any) => {
    const { data } = await api.post<any>(`/pending-updates/${id}/preview`, { editedData });
    return data;
  },

  apply: async (id: string) => {
    const { data } = await api.post<{ success: boolean; flight: any }>(`/pending-updates/${id}/apply`);
    return data;
  },

  reject: async (id: string) => {
    const { data } = await api.post<{ success: boolean }>(`/pending-updates/${id}/reject`);
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/pending-updates/${id}`);
  },
};

export const backupApi = {
  list: async () => {
    const { data } = await api.get<{
      backups: Array<{
        id: string;
        type: string;
        status: string;
        backupPath: string;
        dbBackupPath: string | null;
        filesBackupPath: string | null;
        size: string;
        retentionDays: number;
        startedAt: string | null;
        completedAt: string | null;
        errorMessage: string | null;
        metadata: any;
        syncedToCloud: boolean;
        cloudSyncAt: string | null;
        createdAt: string;
        updatedAt: string;
        fileExists?: boolean;
      }>;
    }>('/backup');
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<{
      backup: {
        id: string;
        type: string;
        status: string;
        backupPath: string;
        dbBackupPath: string | null;
        filesBackupPath: string | null;
        size: string;
        retentionDays: number;
        startedAt: string | null;
        completedAt: string | null;
        errorMessage: string | null;
        metadata: any;
        syncedToCloud: boolean;
        cloudSyncAt: string | null;
        createdAt: string;
        updatedAt: string;
        fileExists?: boolean;
      };
    }>(`/backup/${id}`);
    return data;
  },

  create: async (options?: { type?: 'full' | 'partial'; retentionDays?: number }) => {
    const { data } = await api.post<{
      success: boolean;
      backupId: string;
      message: string;
    }>('/backup', options || {});
    return data;
  },

  download: async (id: string) => {
    const response = await api.get(`/backup/${id}/download`, {
      responseType: 'blob',
    });
    return response.data;
  },

  restore: async (id: string, options: {
    scope: 'full' | 'database' | 'files';
    createBackupBefore?: boolean;
    targetDatabaseUrl?: string;
  }) => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
    }>(`/backup/${id}/restore`, options);
    return data;
  },

  delete: async (id: string) => {
    const { data } = await api.delete<{
      success: boolean;
      message: string;
    }>(`/backup/${id}`);
    return data;
  },

  getStatus: async () => {
    const { data } = await api.get<{
      running: boolean;
      currentBackup: {
        id: string;
        status: string;
        startedAt: string | null;
      } | null;
    }>('/backup/status');
    return data;
  },

  cleanup: async () => {
    const { data } = await api.post<{
      success: boolean;
      deletedCount: number;
      message: string;
    }>('/backup/cleanup');
    return data;
  },

  syncToCloud: async (id: string) => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
    }>(`/backup/${id}/sync`);
    return data;
  },

  listCloudBackups: async () => {
    const { data } = await api.get<{
      backups: Array<{
        name: string;
        size: number;
        lastModified: string;
      }>;
    }>('/backup/cloud/list');
    return data;
  },

  testCloudConnection: async () => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
    }>('/backup/cloud/test');
    return data;
  },

  downloadFromCloud: async (backupName: string) => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
      localPath: string;
    }>('/backup/cloud/download', { backupName });
    return data;
  },
};

// Utility function: Calculate distance between two coordinates using Haversine formula
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number) => deg * (Math.PI / 180);

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default api;
