import { useEffect, useState } from "react";
import { suggestionPluginsApi } from "../lib/api/suggestionPlugins";

const PREFIX = /^plugin:([0-9a-f-]{36}):/;

/**
 * The plugin a place came from (`externalRef = plugin:<id>:<ref>`, spec
 * 2026-11-23, P3), by name — null for any other place, and while the account's
 * plugins load. A removed plugin answers its id's absence with `null` name
 * but `true` origin, so the page can still say the place came from a plugin.
 */
export function usePluginSource(externalRef: string | null | undefined): {
  fromPlugin: boolean;
  name: string | null;
} {
  const id = externalRef ? (PREFIX.exec(externalRef)?.[1] ?? null) : null;
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    suggestionPluginsApi
      .list()
      .then((r) => live && setName(r.plugins.find((p) => p.id === id)?.name ?? null))
      .catch((e: unknown) => console.warn("plugin of the place could not be read", e));
    return () => {
      live = false;
    };
  }, [id]);
  return { fromPlugin: id !== null, name };
}
