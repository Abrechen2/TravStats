/** What the Nutzer and Wartung pages read from the admin API. */

export interface AdminUser {
  id: string;
  username: string;
  isAdmin: boolean;
  isActive: boolean;
  invitedBy?: string;
  createdAt: string;
  /** When the user switched TOTP on; null = off. Drives the reset-2FA action. */
  twoFactorEnabledAt: string | null;
  _count: {
    flights: number;
    userAchievements: number;
  };
}

export interface Invitation {
  id: string;
  email: string | null;
  token: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  emailStatus: string | null;
  emailError: string | null;
  emailSentAt: string | null;
  creator: { username: string };
  user: { username: string } | null;
}

export interface SystemInfoData {
  instanceName: string;
  userCount: number;
  activeUserCount: number;
  flightCount: number;
  maxUsers: number;
  warningThreshold: boolean;
  registrationEnabled: boolean;
  version: string;
  buildVersion?: string;
  demoUserExists?: boolean;
  demoUserActive?: boolean;
}
