import { api } from "./client";
import { apiErrorCode, apiErrorMachineCode, DEMO_FORBIDDEN_CODE } from "../apiError";

/**
 * The per-user location provider (TravTrack plan, `GET/PUT
 * /settings/location-provider`): where the Companion's new recordings go and
 * where automatic features read positions from. Switching moves, copies and
 * deletes nothing.
 */

export type LocationProviderKind = "none" | "travtrack" | "dawarich";
export type LocationProviderStatus = "ok" | "notConfigured" | "unavailable";

export interface LocationProviderSettings {
  kind: LocationProviderKind;
  rev: number;
  status: LocationProviderStatus;
  /** What may be chosen right now; `none` always. */
  choices: { none: true; travtrack: boolean; dawarich: boolean };
}

export const locationProviderApi = {
  get: async (): Promise<LocationProviderSettings> => {
    const { data } = await api.get<LocationProviderSettings>("/settings/location-provider");
    return data;
  },

  set: async (kind: LocationProviderKind): Promise<LocationProviderSettings> => {
    const { data } = await api.put<LocationProviderSettings>("/settings/location-provider", {
      kind,
    });
    return data;
  },
};

/**
 * The i18n key for a failed switch. Each refusal the server names has its own
 * copy; anything else (network, 500) is the generic save failure — never the
 * server's English sentence, never a silent success.
 */
export function locationProviderErrorKey(err: unknown): string {
  if (apiErrorCode(err) === DEMO_FORBIDDEN_CODE) return "common:saveErrors.demo";
  switch (apiErrorMachineCode(err)) {
    case "DAWARICH_NOT_CONFIGURED":
      return "settings:locationProvider.errors.dawarichNotConfigured";
    case "TRAVTRACK_UNAVAILABLE":
      return "settings:locationProvider.errors.travtrackUnavailable";
    default:
      return "settings:locationProvider.errors.saveFailed";
  }
}
