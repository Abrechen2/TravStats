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

const API_URL = (import.meta as any).env?.VITE_API_URL || '';

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

// Imports API
export const importsApi = {
  getPending: async () => {
    const { data } = await api.get<{ imports: any[] }>('/imports/pending');
    return data;
  },
  accept: async (id: string) => {
    const { data } = await api.post(`/imports/${id}/accept`);
    return data;
  },
  reject: async (id: string) => {
    const { data } = await api.post(`/imports/${id}/reject`);
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

// Admin API
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
