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
export type MaintenanceIssue = "noCoordinates" | "noStreet" | "lowPrecision" | "coordsMismatch";
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
    stopEnd?: string | null;
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
  PLZ?: string | null;
  Ort?: string | null;
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

export interface MaintenanceNotice {
  severity: "info" | "warning" | "error";
  code: "readOnly" | "geocoderOff" | "coordsMismatch" | "ambiguousGeocoder" | "severalStops";
  rowId?: string | number;
  name?: string;
  message: string;
  count?: number;
  distanceMeters?: number;
  at?: string;
}

export interface MaintenanceNotices {
  notices: MaintenanceNotice[];
  noticeCount: number;
  totalRows: number;
  stopsSent: number;
  stopsWithheld: "precision" | "travtrackOff" | null;
}

export interface MaintenanceList {
  notices?: MaintenanceNotice[];
  noticeCount?: number;
  rows: MaintenanceRow[];
  totalRows?: number;
  offset?: number;
  applied?: MaintenanceApplied[];
  pendingSearches?: number;
  geocoder?: boolean;
  stopsSent: number;
  stopsWithheld: "precision" | "travtrackOff" | null;
}

/** One plugin's cached maintenance answer as the inbox reads it (no live call). */
export interface MaintenanceInboxEntry {
  plugin: SuggestionPlugin;
  data: Pick<MaintenanceList, "rows" | "notices" | "noticeCount" | "totalRows" | "applied"> | null;
  stopsSent: number;
  stopsWithheld: string | null;
  refreshedAt: string | null;
  /** Why the last refresh failed; `data` is then the older answer. */
  failure: string | null;
}
export interface MaintenanceInbox {
  blocked: string | null;
  plugins: MaintenanceInboxEntry[];
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
  "confirmationRequired",
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
  async maintenance(
    id: string,
    locale: "de" | "en",
    page: { q?: string; offset?: number; limit?: number } = {}
  ): Promise<MaintenanceList> {
    // The plugin may take a while to list its rows (and TravStats sends the stops).
    const { data } = await api.get(`/settings/suggestion-plugins/${id}/maintenance`, {
      params: { locale, ...(page.q ? { q: page.q } : {}), offset: page.offset, limit: page.limit },
      timeout: 30_000,
    });
    return data;
  },
  /**
   * Writes the values the user confirmed. Call it only from the confirm dialog's
   * "confirm": it asks the plugin for a single-use ticket bound to exactly these
   * values, then writes with it. There is no other path to a write.
   */
  async applyLocation(
    id: string,
    input: {
      rowId: string;
      lat: number;
      lon: number;
      street?: string;
      postcode?: string;
      town?: string;
      source: MaintenanceSource;
    }
  ): Promise<{ undoId: string; rowId: string; written: MaintenanceWritten }> {
    const { source: _source, ...values } = input;
    const base = `/settings/suggestion-plugins/${id}/maintenance`;
    const { data: ticket } = await api.post(
      `${base}/confirm`,
      { kind: "apply", ...values },
      { timeout: 30_000 }
    );
    const { data } = await api.post(
      `${base}/apply`,
      { ...input, token: ticket.token },
      { timeout: 30_000 }
    );
    return data;
  },
  async notices(id: string, locale: "de" | "en"): Promise<MaintenanceNotices> {
    const { data } = await api.get(`/settings/suggestion-plugins/${id}/maintenance/notices`, {
      params: { locale },
      timeout: 30_000,
    });
    return data;
  },
  async undoLocation(
    id: string,
    undoId: string
  ): Promise<{ undoId: string; rowId: string; restored: MaintenanceWritten }> {
    const base = `/settings/suggestion-plugins/${id}/maintenance`;
    const { data: ticket } = await api.post(
      `${base}/confirm`,
      { kind: "undo", undoId },
      { timeout: 30_000 }
    );
    const { data } = await api.post(
      `${base}/undo`,
      { undoId, token: ticket.token },
      { timeout: 30_000 }
    );
    return data;
  },
  /** The inbox's cached proposals and notices of every plugin; asks no plugin. */
  async maintenanceInbox(): Promise<MaintenanceInbox> {
    const { data } = await api.get("/settings/suggestion-plugins/maintenance/inbox");
    return data;
  },
  /** "Jetzt aktualisieren": every plugin asked live (rate-limited on the server). */
  async refreshMaintenanceInbox(locale: "de" | "en"): Promise<MaintenanceInbox> {
    const { data } = await api.post(
      "/settings/suggestion-plugins/maintenance/refresh",
      { locale },
      { timeout: 120_000 }
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
