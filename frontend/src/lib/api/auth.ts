import type { User } from "../../types";

import { api } from "./client";

export type LoginResult = { user: User } | { requiresPasswordChange: true; changeToken: string };

// Auth API
export const authApi = {
  register: async (
    username: string,
    password: string,
    invitationToken?: string
  ): Promise<{ user: User }> => {
    const { data } = await api.post<{ user: User }>("/auth/register", {
      username,
      password,
      ...(invitationToken ? { invitationToken } : {}),
    });
    return data;
  },

  login: async (username: string, password: string): Promise<LoginResult> => {
    const { data } = await api.post<LoginResult>("/auth/login", {
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

  getSmtpStatus: async (): Promise<{ smtpEnabled: boolean }> => {
    const { data } = await api.get<{ smtpEnabled: boolean }>("/auth/smtp-status");
    return data;
  },

  forgotPassword: async (username: string): Promise<{ message: string }> => {
    const { data } = await api.post<{ message: string }>("/auth/forgot-password", { username });
    return data;
  },

  resetPassword: async (token: string, newPassword: string): Promise<{ message: string }> => {
    const { data } = await api.post<{ message: string }>("/auth/reset-password", {
      token,
      newPassword,
    });
    return data;
  },

  forceChangePassword: async (
    changeToken: string,
    newPassword: string
  ): Promise<{ message: string }> => {
    const { data } = await api.post<{ message: string }>("/auth/force-change-password", {
      changeToken,
      newPassword,
    });
    return data;
  },
};
