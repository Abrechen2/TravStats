import { api } from "./client";

// Setup API
export const setupApi = {
  getStatus: async (): Promise<{
    setupComplete: boolean;
    requiresSetup: boolean;
    message: string;
  }> => {
    const { data } = await api.get<{
      setupComplete: boolean;
      requiresSetup: boolean;
      message: string;
    }>("/setup/status");
    return data;
  },

  initialize: async (payload: {
    username: string;
    password: string;
    instanceName?: string;
    frontendUrl?: string;
    maxUsers?: number;
    allowRegistration?: boolean;
  }): Promise<{
    success: boolean;
    message: string;
    user: { id: string; username: string; isAdmin: boolean };
  }> => {
    const { data } = await api.post<{
      success: boolean;
      message: string;
      user: { id: string; username: string; isAdmin: boolean };
    }>("/setup/initialize", payload);
    return data;
  },

  getAirportSeedingStatus: async (): Promise<{
    status: "pending" | "running" | "completed" | "failed";
    progress?: number; // 0-1
    estimatedSecondsRemaining?: number;
    totalAirports?: number;
    processedAirports?: number;
    error?: string;
  }> => {
    const { data } = await api.get<{
      status: "pending" | "running" | "completed" | "failed";
      progress?: number; // 0-1
      estimatedSecondsRemaining?: number;
      totalAirports?: number;
      processedAirports?: number;
      error?: string;
    }>("/setup/airport-seeding-status");
    return data;
  },
};
