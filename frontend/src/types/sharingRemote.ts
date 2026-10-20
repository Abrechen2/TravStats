import type { ShareConsent } from "./sharing";

/** Mirrors `backend/src/schemas/sharingRemote.ts`. */
export interface RemoteSharingStatus {
  available: boolean;
  reason: "beta-off" | "switch-off" | "no-identity" | null;
  origin: string | null;
}

export interface RemoteInvite {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreatedRemoteInvite extends RemoteInvite {
  /** `<origin>#trip:<64 hex>` — shown this once. */
  code: string;
}

export interface RemotePerson {
  id: string;
  origin: string;
  username: string;
  displayName: string;
  consent: ShareConsent["status"];
  createdAt: string;
}
