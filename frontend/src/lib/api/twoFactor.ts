import { api } from "./client";

export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
}

export const twoFactorApi = {
  getTwoFactorStatus: async (): Promise<TwoFactorStatus> => {
    const { data } = await api.get<TwoFactorStatus>("/auth/2fa/status");
    return data;
  },

  setupTwoFactor: async (): Promise<TwoFactorSetup> => {
    const { data } = await api.post<TwoFactorSetup>("/auth/2fa/setup");
    return data;
  },

  activateTwoFactor: async (code: string): Promise<{ recoveryCodes: string[] }> => {
    const { data } = await api.post<{ recoveryCodes: string[] }>("/auth/2fa/activate", { code });
    return data;
  },

  disableTwoFactor: async (password: string): Promise<void> => {
    await api.post("/auth/2fa/disable", { password });
  },

  regenerateRecoveryCodes: async (password: string): Promise<{ recoveryCodes: string[] }> => {
    const { data } = await api.post<{ recoveryCodes: string[] }>("/auth/2fa/recovery-codes", {
      password,
    });
    return data;
  },
};
