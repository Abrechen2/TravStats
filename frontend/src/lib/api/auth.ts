import type { User } from "../../types";

import { api } from "./client";

// Auth API
export const authApi = {
  register: async (username: string, password: string): Promise<{ user: User }> => {
    const { data } = await api.post<{ user: User }>("/auth/register", {
      username,
      password,
    });
    return data;
  },

  login: async (username: string, password: string): Promise<{ user: User }> => {
    const { data } = await api.post<{ user: User }>("/auth/login", {
      username,
      password,
    });
    return data;
  },

  logout: async (): Promise<void> => {
    await api.post("/auth/logout");
  },

  changePassword: async (
    oldPassword: string,
    newPassword: string
  ): Promise<{ message: string }> => {
    const { data } = await api.post<{ message: string }>("/auth/change-password", {
      oldPassword,
      newPassword,
    });
    return data;
  },
};
