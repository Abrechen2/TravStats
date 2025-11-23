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

const API_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_URL ? `${API_URL}/api/v1` : '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 second timeout
  withCredentials: true, // Send cookies with every request (HttpOnly JWT)
});

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

export default api;
