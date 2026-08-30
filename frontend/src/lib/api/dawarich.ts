import { api } from "./client";
import {
  DAWARICH_FAILURE_KINDS,
  type DawarichConnectionStatus,
  type DawarichFailureKind,
  type DawarichTestResult,
} from "../../types/dawarich";

/** Narrow an arbitrary value to one of the fixed Dawarich failure kinds. */
export function isDawarichFailureKind(value: unknown): value is DawarichFailureKind {
  return typeof value === "string" && (DAWARICH_FAILURE_KINDS as readonly string[]).includes(value);
}

/**
 * Pull the machine-readable kind out of a failed Dawarich-backed request
 * (the settings test call, or the tour track "pull from Dawarich" call —
 * both endpoints answer this exact vocabulary in `{ error: kind }`) so the
 * UI can render a specific message instead of a generic error toast.
 *
 * Returns `null` for a request that failed for some OTHER reason — a
 * validation 400 carrying plain prose (e.g. "this section has no dated
 * stops …"), a network drop, a 500. The caller must fall back to that raw
 * message in that case, never to a fabricated kind.
 */
export function dawarichFailureKind(error: unknown): DawarichFailureKind | null {
  if (typeof error !== "object" || error === null) return null;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  const kind = response?.data?.error;
  return isDawarichFailureKind(kind) ? kind : null;
}

/**
 * Resolve a failure kind to its localized i18n key inside the `trips`
 * namespace (Dawarich only has one consumer in this app — the tour track
 * feature — so its copy lives alongside `tours.tracks.*` rather than in a
 * dedicated namespace). Both the settings connection card and the track
 * "pull from Dawarich" flow share this one vocabulary; a kind handled in
 * one and forgotten in the other would be exactly the kind of drift this
 * function exists to prevent.
 */
export function dawarichFailureKey(kind: unknown): string {
  return isDawarichFailureKind(kind)
    ? `trips:tours.tracks.dawarich.errors.${kind}`
    : "trips:tours.tracks.dawarich.error";
}

export const dawarichApi = {
  getSettings: async (): Promise<DawarichConnectionStatus> => {
    const { data } = await api.get<DawarichConnectionStatus>("/settings/dawarich");
    return data;
  },

  updateSettings: async (payload: {
    baseUrl?: string | null;
    apiKey?: string | null;
  }): Promise<DawarichConnectionStatus> => {
    const { data } = await api.put<DawarichConnectionStatus>("/settings/dawarich", payload);
    return data;
  },

  testConnection: async (payload: {
    baseUrl?: string;
    apiKey?: string;
  }): Promise<DawarichTestResult> => {
    const { data } = await api.post<DawarichTestResult>("/settings/dawarich/test", payload);
    return data;
  },
};
