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
  FlightLookupResult
} from '../types';

export const API_URL = (import.meta as any).env?.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_URL ? `${API_URL}/api/v1` : '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 second timeout
  withCredentials: true, // Send cookies with every request (HttpOnly JWT)
});

// Response interceptor for handling 401 errors (expired/invalid tokens)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid - redirect to login
      // Import dynamically to avoid circular dependencies
      import('../store/authStore').then(({ useAuthStore }) => {
        const authStore = useAuthStore.getState();
        authStore.logout();
        window.location.href = '/login';
      });
    }
    return Promise.reject(error);
  }
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
};

// Parse API (Email & Boarding Pass)
export const parseApi = {
  parseEmail: async (emailContent: string, subject?: string) => {
    const { data } = await api.post('/parse-email', {
      emailContent,
      subject,
    });
    return data;
  },

  parseBoardingpass: async (imageBase64: string, enrichWithApi = true) => {
    const { data } = await api.post('/parse-boardingpass', {
      imageBase64,
      enrichWithApi,
    });
    return data;
  },

  checkOllamaVision: async () => {
    const { data } = await api.get('/parse-boardingpass/check');
    return data;
  },

  // Get available parser providers
  getProviders: async () => {
    const { data } = await api.get<{
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
};

// Analytics API
export const analyticsApi = {
  track: async (type: string, payload?: Record<string, any>) => {
    await api.post('/analytics/events', { type, payload });
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
