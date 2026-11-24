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
];
const CODES: readonly string[] = [
  "PRIVATE_TARGET",
  "CALENDAR_HTTPS_REQUIRED",
  "PLUGIN_LIMIT",
  "PLUGIN_BACKFILL_REFUSED",
  "PLUGIN_BACKFILL_RUNNING",
  "SERVICE_DISABLED",
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
  async reask(stayId: string): Promise<number> {
    const { data } = await api.post("/settings/suggestion-plugins/reask", { stayId });
    return data.pending;
  },
};
