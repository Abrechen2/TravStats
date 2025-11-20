import axios from 'axios';
import type {
  User,
  Flight,
  FlightInput,
  FlightFilters,
  Stats,
  Route,
  GeoJSONFeatureCollection
} from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth API
export const authApi = {
  register: async (username: string, password: string) => {
    const { data } = await api.post<{ token: string; user: User }>('/auth/register', {
      username,
      password,
    });
    return data;
  },

  login: async (username: string, password: string) => {
    const { data } = await api.post<{ token: string; user: User }>('/auth/login', {
      username,
      password,
    });
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

export default api;
