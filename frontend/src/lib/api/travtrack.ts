import { api } from "./client";
import { apiErrorMachineCode } from "../apiError";

/**
 * TravTrack, the own location history (TravTrack plan, phase 2): what it does
 * on this server for this account, and the admin's instance switch.
 */

export interface TravTrackCapabilities {
  version: 1;
  /** The beta switch offers TravTrack on this server. */
  offered: boolean;
  /** The instance captures and shows TravTrack (beta switch + admin switch). */
  enabled: boolean;
  /** This account's location provider is TravTrack and it works. */
  active: boolean;
  /** This account holds TravTrack data: summary, export and delete stay reachable. */
  hasData: boolean;
}

export interface TravTrackConfig {
  enabled: boolean;
}

export const travTrackApi = {
  capabilities: async (): Promise<TravTrackCapabilities> =>
    (await api.get<TravTrackCapabilities>("/travtrack/capabilities")).data,
  config: async (): Promise<TravTrackConfig> =>
    (await api.get<TravTrackConfig>("/travtrack/config")).data,
  setConfig: async (config: TravTrackConfig): Promise<TravTrackConfig> =>
    (await api.patch<TravTrackConfig>("/travtrack/config", config)).data,
};

/** The i18n key for a failed TravTrack call; a refusal by name, anything else generic. */
export function travTrackErrorKey(err: unknown): string {
  switch (apiErrorMachineCode(err)) {
    case "TRAVTRACK_DISABLED":
      return "admin:travTrack.errors.disabled";
    default:
      return "admin:travTrack.errors.saveFailed";
  }
}
