import type { Flight } from "../../types";

import { api } from "./client";
import type { FlightUpdateData, PendingUpdate } from "./types";

// Pending Updates API
export const pendingUpdatesApi = {
  getAll: async (filters?: {
    status?: string;
    flightId?: string;
  }): Promise<{
    updates: PendingUpdate[];
    count: number;
  }> => {
    const { data } = await api.get<{
      updates: PendingUpdate[];
      count: number;
    }>("/pending-updates", { params: filters });
    return data;
  },

  getById: async (id: string): Promise<PendingUpdate> => {
    const { data } = await api.get<PendingUpdate>(`/pending-updates/${id}`);
    return data;
  },

  getStatistics: async (): Promise<{
    totalUpdates: number;
    appliedUpdates: number;
    rejectedUpdates: number;
    editedUpdates: number;
    expiredUpdates: number;
    mostChangedFields: Record<string, number>;
    averageUpdateTime: number | null;
  }> => {
    const { data } = await api.get<{
      totalUpdates: number;
      appliedUpdates: number;
      rejectedUpdates: number;
      editedUpdates: number;
      expiredUpdates: number;
      mostChangedFields: Record<string, number>;
      averageUpdateTime: number | null;
    }>("/pending-updates/statistics");
    return data;
  },

  update: async (id: string, editedData: FlightUpdateData): Promise<PendingUpdate> => {
    const { data } = await api.put<PendingUpdate>(`/pending-updates/${id}`, { editedData });
    return data;
  },

  preview: async (id: string, editedData?: FlightUpdateData): Promise<Record<string, unknown>> => {
    const { data } = await api.post<Record<string, unknown>>(`/pending-updates/${id}/preview`, {
      editedData,
    });
    return data;
  },

  apply: async (id: string): Promise<{ success: boolean; flight: Flight }> => {
    const { data } = await api.post<{ success: boolean; flight: Flight }>(
      `/pending-updates/${id}/apply`
    );
    return data;
  },

  reject: async (id: string): Promise<{ success: boolean }> => {
    const { data } = await api.post<{ success: boolean }>(`/pending-updates/${id}/reject`);
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/pending-updates/${id}`);
  },
};
