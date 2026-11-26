import { useCallback, useEffect, useState } from "react";
import {
  pluginFailureKey,
  pluginRequestFailureKey,
  suggestionPluginsApi,
  type MaintenanceApplied,
  type MaintenanceInbox,
  type SuggestionPlugin,
} from "../../../lib/api/suggestionPlugins";
import { entriesOf, type PluginEntry } from "./pluginInboxModel";

export interface PluginInbox {
  loaded: boolean;
  /** Plugins whose last refresh failed (their older answer is still listed), or the read itself. */
  failed: { plugin: SuggestionPlugin | null; key: string }[];
  plugins: SuggestionPlugin[];
  entries: PluginEntry[];
  applied: { plugin: SuggestionPlugin; item: MaintenanceApplied }[];
  /** Rows beyond the cached first page, per plugin id. */
  more: Record<string, number>;
  /** The oldest copy's time; null when a plugin was never asked yet. */
  refreshedAt: string | null;
  refreshing: boolean;
  /** Re-read the cached copy (after a write the server refreshed it). */
  reload: () => Promise<void>;
  /** "Jetzt aktualisieren": ask every plugin live. */
  refresh: () => Promise<void>;
}

type State = Omit<PluginInbox, "reload" | "refresh">;
const EMPTY: State = {
  loaded: false,
  failed: [],
  plugins: [],
  entries: [],
  applied: [],
  more: {},
  refreshedAt: null,
  refreshing: false,
};

function stateOf(inbox: MaintenanceInbox): State {
  const next: State = {
    ...EMPTY,
    loaded: true,
    failed: [],
    plugins: [],
    entries: [],
    applied: [],
    more: {},
  };
  let oldest: string | null | undefined;
  for (const e of inbox.plugins) {
    next.plugins.push(e.plugin);
    if (e.failure) next.failed.push({ plugin: e.plugin, key: pluginFailureKey(e.failure) });
    if (oldest !== null)
      oldest = !e.refreshedAt ? null : !oldest || e.refreshedAt < oldest ? e.refreshedAt : oldest;
    if (!e.data) continue;
    next.entries.push(...entriesOf(e.plugin, e.data.rows ?? [], e.data.notices ?? []));
    next.applied.push(...(e.data.applied ?? []).map((item) => ({ plugin: e.plugin, item })));
    const total = e.data.totalRows ?? e.data.rows?.length ?? 0;
    if (total > (e.data.rows?.length ?? 0)) next.more[e.plugin.id] = total - e.data.rows.length;
  }
  next.refreshedAt = oldest ?? null;
  return next;
}

/** A refused or failed request as its i18n key; a 429 is the rate limit, whatever the body says. */
function requestKey(e: unknown): string {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === 429 ? "plugins.failure.reason.rateLimited" : pluginRequestFailureKey(e);
}

/**
 * The Plugins tab's data: the server's cached copy of every plugin's maintenance answer (a paced
 * poll keeps it fresh), so opening the inbox asks no plugin. A failed refresh is named next to the
 * older answer it left; "Jetzt aktualisieren" asks live.
 */
export function usePluginInbox(locale: "de" | "en"): PluginInbox {
  const [state, setState] = useState<State>(EMPTY);

  const run = useCallback(async (read: () => Promise<MaintenanceInbox>) => {
    setState((s) => ({ ...s, refreshing: true }));
    try {
      setState(stateOf(await read()));
    } catch (e) {
      const key = requestKey(e);
      console.warn("plugin inbox: the read failed", key);
      setState((s) => ({
        ...s,
        loaded: true,
        refreshing: false,
        failed: [{ plugin: null, key }, ...s.failed.filter((f) => f.plugin !== null)],
      }));
    }
  }, []);

  const reload = useCallback(() => run(() => suggestionPluginsApi.maintenanceInbox()), [run]);
  const refresh = useCallback(
    () => run(() => suggestionPluginsApi.refreshMaintenanceInbox(locale)),
    [run, locale]
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, refresh };
}
