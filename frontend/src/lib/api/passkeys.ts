import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

import { api } from "./client";
import type { User } from "../../types";

export interface Passkey {
  id: string;
  name: string;
  /** The RP ID this key was minted under — shown so a key that cannot work
   *  under the current origin is legible rather than mysterious. */
  rpId: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export type PasskeyUnavailableReason = "notConfigured" | "insecureOrigin";

export interface PasskeyAvailability {
  available: boolean;
  reason: PasskeyUnavailableReason | null;
}

export const passkeyApi = {
  /** Asked before any button is drawn: passkeys are impossible on an insecure
   *  origin, and a button that always fails is worse than an explanation. */
  availability: async (): Promise<PasskeyAvailability> => {
    const { data } = await api.get<PasskeyAvailability>("/auth/passkeys/availability");
    return data;
  },

  list: async (): Promise<Passkey[]> => {
    const { data } = await api.get<{ passkeys: Passkey[] }>("/auth/passkeys");
    return data.passkeys;
  },

  registerOptions: async (): Promise<PublicKeyCredentialCreationOptionsJSON> => {
    const { data } = await api.post<PublicKeyCredentialCreationOptionsJSON>(
      "/auth/passkeys/register/options"
    );
    return data;
  },

  registerVerify: async (
    name: string,
    response: unknown
  ): Promise<{ id: string; name: string }> => {
    const { data } = await api.post<{ id: string; name: string }>(
      "/auth/passkeys/register/verify",
      { name, response }
    );
    return data;
  },

  loginOptions: async (): Promise<PublicKeyCredentialRequestOptionsJSON> => {
    const { data } = await api.post<PublicKeyCredentialRequestOptionsJSON>(
      "/auth/passkeys/login/options"
    );
    return data;
  },

  loginVerify: async (response: unknown): Promise<{ user: User }> => {
    const { data } = await api.post<{ user: User }>("/auth/passkeys/login/verify", { response });
    return data;
  },

  rename: async (id: string, name: string): Promise<void> => {
    await api.patch(`/auth/passkeys/${id}`, { name });
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/auth/passkeys/${id}`);
  },
};
