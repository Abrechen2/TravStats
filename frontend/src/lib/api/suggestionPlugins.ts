import { api } from "./client";

/** Suggestion plugins of the account (spec 2026-11-23-plugins-and-calendar.md, Part B). */
export type PluginPrecision = "exact" | "100m" | "1km";
export type PluginFailure =
  "timeout" | "unreachable" | "auth" | "rateLimited" | "protocol" | "server" | "privateTarget";

export interface SuggestionPlugin {
  id: string;
  name: string;
  url: string;
  precision: PluginPrecision;
  enabled: boolean;
  backfillAllowed: boolean;
  secretSet: boolean;
  lastVersion: number | null;
  lastOutcome: string | null;
  lastCalledAt: string | null;
  lastErrorAt: string | null;
  retryAt: string | null;
}

export interface PluginSuggestionView {
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
  purpose?: "private" | "business";
  note?: string;
  externalRef?: string;
  url?: string;
  confidence: number;
  /** Additive: `name` = a distinctive word of the venue matched further away. */
  reason?: "distance" | "name";
  distanceMeters?: number;
  matchedToken?: string;
}

/** Location maintenance (optional plugin capability `maintenance`, owner 2026-11-24). */
export type MaintenanceIssue = "noCoordinates" | "noStreet" | "lowPrecision";
export type MaintenanceSource = "stop" | "geocoder" | "manual";

export interface MaintenanceProposal {
  source: "stop" | "geocoder";
  lat: number;
  lon: number;
  address?: string;
  street?: string;
  confidence: "high" | "medium" | "low";
  evidence?: {
    venueName?: string;
    stopStart?: string | null;
    query?: string;
    label?: string;
    matchedTokens?: string[];
    distanceMeters?: number;
    agreesWithGeocoder?: boolean;
    agreesWithStop?: boolean;
  };
}

export interface MaintenanceRow {
  rowId: string;
  projNr?: string | null;
  name: string;
  street?: string | null;
  postcode?: string | null;
  town?: string | null;
  lat?: number | null;
  lon?: number | null;
  issues: MaintenanceIssue[];
  ignored?: boolean;
  proposals: MaintenanceProposal[];
}

export interface MaintenanceWritten {
  Latitude?: number | null;
  Longitude?: number | null;
  Strasse?: string | null;
}

export interface MaintenanceApplied {
  undoId: string;
  rowId: string;
  name: string;
  written: MaintenanceWritten;
  previous?: MaintenanceWritten;
  source: string;
  appliedAt: string;
}

export interface MaintenanceList {
  rows: MaintenanceRow[];
  totalRows?: number;
  applied?: MaintenanceApplied[];
  pendingSearches?: number;
  geocoder?: boolean;
  stopsSent: number;
  stopsWithheld: "precision" | "travtrackOff" | null;
}

export interface PluginTestResult {
  ok: true;
  outcome: "ok" | "empty";
  latencyMs: number;
  version: number | null;
  first: PluginSuggestionView | null;
  hello: { name: string; version: number; kinds: string[] } | null;
}

const FAILURES: readonly string[] = [
  "timeout",
  "unreachable",
  "auth",
  "rateLimited",
  "protocol",
  "server",
  "privateTarget",
  "readOnly",
  "changed",
  "notFound",
  "notReady",
  "unsupported",
];
const CODES: readonly string[] = [
  "PRIVATE_TARGET",
  "CALENDAR_HTTPS_REQUIRED",
  "PLUGIN_LIMIT",
  "PLUGIN_BACKFILL_REFUSED",
  "PLUGIN_BACKFILL_RUNNING",
  "SERVICE_DISABLED",
  "PLUGIN_NO_MAINTENANCE",
];

/** The i18n key (namespace `suggestionSources`) of a stored outcome or a failed request. */
export function pluginFailureKey(reason: unknown, code?: unknown): string {
  if (typeof code === "string" && code !== "PLUGIN_FAILED" && CODES.includes(code))
    return `plugins.failure.code.${code}`;
  if (typeof reason === "string" && FAILURES.includes(reason))
    return `plugins.failure.reason.${reason}`;
  return "plugins.failure.unknown";
}

export function pluginRequestFailureKey(error: unknown): string {
  const data = (error as { response?: { data?: { error?: unknown; code?: unknown } } })?.response
    ?.data;
  return pluginFailureKey(data?.error, data?.code);
}

export const suggestionPluginsApi = {
  async list(): Promise<{
    plugins: SuggestionPlugin[];
    blocked: "internet_off" | "service_off" | null;
  }> {
    const { data } = await api.get("/settings/suggestion-plugins");
    return data;
  },
  async add(input: {
    name: string;
    url: string;
    precision: PluginPrecision;
    backfillAllowed: boolean;
  }): Promise<{ plugin: SuggestionPlugin; secret: string }> {
    const { data } = await api.post("/settings/suggestion-plugins", input);
    return data;
  },
  async update(
    id: string,
    patch: Partial<
      Pick<SuggestionPlugin, "name" | "url" | "precision" | "enabled" | "backfillAllowed">
    >
  ): Promise<SuggestionPlugin> {
    const { data } = await api.patch(`/settings/suggestion-plugins/${id}`, patch);
    return data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/settings/suggestion-plugins/${id}`);
  },
  async rotate(id: string): Promise<string> {
    const { data } = await api.post(`/settings/suggestion-plugins/${id}/rotate`, {});
    return data.secret;
  },
  async test(id: string): Promise<PluginTestResult> {
    const { data } = await api.post(`/settings/suggestion-plugins/${id}/test`, {});
    return data;
  },
  async backfill(id: string, from: string, to: string): Promise<string> {
    const { data } = await api.post(`/settings/suggestion-plugins/${id}/backfill`, { from, to });
    return data.jobId;
  },
  async capabilities(
    id: string
  ): Promise<{ capabilities: string[]; maintenance: boolean; error: string | null }> {
    const { data } = await api.get(`/settings/suggestion-plugins/${id}/capabilities`);
    return data;
  },
  async maintenance(id: string, locale: "de" | "en"): Promise<MaintenanceList> {
    // The plugin may take a while to list its rows (and TravStats sends the stops).
    const { data } = await api.get(`/settings/suggestion-plugins/${id}/maintenance`, {
      params: { locale },
      timeout: 30_000,
    });
    return data;
  },
  async applyLocation(
    id: string,
    input: { rowId: string; lat: number; lon: number; street?: string; source: MaintenanceSource }
  ): Promise<{ undoId: string; rowId: string; written: MaintenanceWritten }> {
    const { data } = await api.post(`/settings/suggestion-plugins/${id}/maintenance/apply`, input, {
      timeout: 30_000,
    });
    return data;
  },
  async undoLocation(
    id: string,
    undoId: string
  ): Promise<{ undoId: string; rowId: string; restored: MaintenanceWritten }> {
    const { data } = await api.post(
      `/settings/suggestion-plugins/${id}/maintenance/undo`,
      { undoId },
      { timeout: 30_000 }
    );
    return data;
  },
  async ignoreRow(id: string, rowId: string, ignored: boolean): Promise<void> {
    await api.post(`/settings/suggestion-plugins/${id}/maintenance/ignore`, { rowId, ignored });
  },
  async reask(stayId: string): Promise<number> {
    const { data } = await api.post("/settings/suggestion-plugins/reask", { stayId });
    return data.pending;
  },
};
