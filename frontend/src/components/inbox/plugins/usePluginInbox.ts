import { useCallback, useEffect, useState } from "react";
import {
  pluginRequestFailureKey,
  suggestionPluginsApi,
  type MaintenanceApplied,
  type SuggestionPlugin,
} from "../../../lib/api/suggestionPlugins";
import { entriesOf, type PluginEntry } from "./pluginInboxModel";

/** Rows read per plugin for the inbox; the settings dialog pages through the rest. */
export const INBOX_PAGE = 50;

export interface PluginInbox {
  loaded: boolean;
  /** Plugins (or the plugin list itself, `plugin: null`) that did not answer, with the i18n key. */
  failed: { plugin: SuggestionPlugin | null; key: string }[];
  plugins: SuggestionPlugin[];
  entries: PluginEntry[];
  applied: { plugin: SuggestionPlugin; item: MaintenanceApplied }[];
  /** Rows beyond the first page, per plugin id. */
  more: Record<string, number>;
  reload: () => Promise<void>;
}

/**
 * Reads every enabled plugin that offers maintenance: its rows with proposals, its notices and the
 * writes that can still be undone. One plugin that fails is named and never hides the others.
 */
export function usePluginInbox(locale: "de" | "en", active: boolean): PluginInbox {
  const [state, setState] = useState<Omit<PluginInbox, "reload">>({
    loaded: false,
    failed: [],
    plugins: [],
    entries: [],
    applied: [],
    more: {},
  });

  const reload = useCallback(async () => {
    let plugins: SuggestionPlugin[];
    try {
      const listed = await suggestionPluginsApi.list();
      plugins = listed.blocked ? [] : listed.plugins.filter((p) => p.enabled);
    } catch (e) {
      const key = pluginRequestFailureKey(e);
      console.warn("plugin inbox: the plugin list failed", key);
      setState({
        loaded: true,
        failed: [{ plugin: null, key }],
        plugins: [],
        entries: [],
        applied: [],
        more: {},
      });
      return;
    }
    const results = await Promise.all(
      plugins.map(async (plugin) => {
        try {
          const caps = await suggestionPluginsApi.capabilities(plugin.id);
          if (!caps.maintenance) return { kind: "skip" as const, plugin };
          const list = await suggestionPluginsApi.maintenance(plugin.id, locale, {
            limit: INBOX_PAGE,
          });
          return { kind: "ok" as const, plugin, list };
        } catch (e) {
          const key = pluginRequestFailureKey(e);
          console.warn("plugin inbox: a plugin did not answer", plugin.id, key);
          return { kind: "failed" as const, plugin, key };
        }
      })
    );
    const next: Omit<PluginInbox, "reload"> = {
      loaded: true,
      failed: [],
      plugins: [],
      entries: [],
      applied: [],
      more: {},
    };
    for (const r of results) {
      if (r.kind === "skip") continue;
      next.plugins.push(r.plugin);
      if (r.kind === "failed") {
        next.failed.push({ plugin: r.plugin, key: r.key });
        continue;
      }
      next.entries.push(...entriesOf(r.plugin, r.list.rows, r.list.notices ?? []));
      next.applied.push(...(r.list.applied ?? []).map((item) => ({ plugin: r.plugin, item })));
      const total = r.list.totalRows ?? r.list.rows.length;
      if (total > r.list.rows.length) next.more[r.plugin.id] = total - r.list.rows.length;
    }
    setState(next);
  }, [locale]);

  useEffect(() => {
    if (active) void reload();
  }, [active, reload]);

  return { ...state, reload };
}
