import type { User } from "../../types";

import { api } from "./client";

export type LoginResult =
  | { user: User }
  | { requiresPasswordChange: true }
  | { requiresTwoFactor: true };

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

  /**
   * Redeem the login challenge. The `twofa_token` cookie set by `login` is the
   * credential here — there is no session yet, so this call carries no auth
   * header and relies on `withCredentials` like every other call.
   */
  verifyTwoFactor: async (
    body: { code: string } | { recoveryCode: string }
  ): Promise<{ user: User }> => {
    const { data } = await api.post<{ user: User }>("/auth/2fa/verify", body);
    return data;
  },

  logout: async (): Promise<void> => {
    await api.post("/auth/logout");
  },

  /** Validates the HttpOnly session cookie. Rejects with 401 when it is gone. */
  me: async (): Promise<{ user: User }> => {
    const { data } = await api.get<{ user: User }>("/auth/me");
    return data;
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

  getSmtpStatus: async (): Promise<{
    smtpEnabled: boolean;
    adminContactEmail: string | null;
  }> => {
    const { data } = await api.get<{
      smtpEnabled: boolean;
      adminContactEmail: string | null;
    }>("/auth/smtp-status");
    return data;
  },

  getRegistrationStatus: async (): Promise<{
    registrationEnabled: boolean;
    requiresInvitation: boolean;
    limitReached: boolean;
  }> => {
    const { data } = await api.get<{
      registrationEnabled: boolean;
      requiresInvitation: boolean;
      limitReached: boolean;
    }>("/auth/registration-status");
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

  forceChangePassword: async (newPassword: string): Promise<{ message: string }> => {
    // changeToken is delivered via HttpOnly cookie — only send the new password
    const { data } = await api.post<{ message: string }>("/auth/force-change-password", {
      newPassword,
    });
    return data;
  },
};
