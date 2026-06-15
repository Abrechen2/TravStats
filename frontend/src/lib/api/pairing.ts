/**
 * Device-pairing API — cookie-authenticated browser surface.
 *
 * `start()` mints a one-time pairing code plus the public base URL the
 * mobile app should connect to; `status()` polls whether a phone has
 * claimed that code yet. Both routes are cookie-only on the backend — a
 * PAT cannot mint or inspect pairing codes (privilege-escalation
 * defence), so we rely on the shared `api` instance's `withCredentials`.
 */

import { api } from "./client";

export interface PairingStart {
  /** One-time pairing code the phone exchanges for a device token. */
  code: string;
  /** Public base URL to embed in the QR. Empty if no public URL is configured. */
  publicUrl: string;
  /** ISO timestamp when the code expires. */
  expiresAt: string;
}

export interface PairingStatus {
  claimed: boolean;
  deviceName?: string;
}

export const pairingApi = {
  start: async (): Promise<PairingStart> => {
    const { data } = await api.post<PairingStart>("/pairing/start");
    return data;
  },

  status: async (code: string): Promise<PairingStatus> => {
    const { data } = await api.get<PairingStatus>(
      `/pairing/status/${encodeURIComponent(code)}`,
    );
    return data;
  },
};
