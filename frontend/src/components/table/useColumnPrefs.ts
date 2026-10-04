import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import { emitLocalPrefWrite, useWebPrefsEpoch } from "../../lib/webPrefs/prefEvents";

/**
 * Per-table column visibility, persisted to localStorage. The stored value is
 * the list of HIDDEN column ids — so a column added in a later release is
 * visible by default instead of silently missing for everyone with an old
 * preference blob. Shared by the flights, cruises and lodging list pages
 * (owner principle: the table pages look the same across domains, only the
 * content differs).
 *
 * Follows the user across browsers (forgejo#200, `lib/webPrefs/registry.ts`).
 */

export const TABLE_HIDDEN_COLUMNS_PREFIX = "travstats:table-hidden-columns:";
const STORAGE_PREFIX = TABLE_HIDDEN_COLUMNS_PREFIX;

function readHidden(key: string): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch (err) {
    logger.warn("useColumnPrefs: unreadable preference, starting fresh", err);
    return [];
  }
}

export interface ColumnPrefs {
  /** True when the column should render. Unknown ids are visible. */
  isVisible: (id: string) => boolean;
  /** Flip one column. No-op for ids listed in `alwaysVisible`. */
  toggle: (id: string) => void;
  hiddenIds: readonly string[];
}

export function useColumnPrefs(
  tableKey: string,
  alwaysVisible: readonly string[] = []
): ColumnPrefs {
  const [hidden, setHidden] = useState<string[]>(() => readHidden(tableKey));

  // The server's copy arrived after mount: show it (forgejo#200).
  const syncEpoch = useWebPrefsEpoch("tablePrefs");
  const seenEpoch = useRef(syncEpoch);
  useEffect(() => {
    if (seenEpoch.current === syncEpoch) return;
    seenEpoch.current = syncEpoch;
    setHidden(readHidden(tableKey));
  }, [syncEpoch, tableKey]);

  const isVisible = useCallback((id: string): boolean => !hidden.includes(id), [hidden]);

  const toggle = useCallback(
    (id: string): void => {
      if (alwaysVisible.includes(id)) return;
      setHidden((prev) => {
        const next = prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id];
        try {
          localStorage.setItem(STORAGE_PREFIX + tableKey, JSON.stringify(next));
        } catch (err) {
          logger.warn("useColumnPrefs: could not persist preference", err);
        }
        emitLocalPrefWrite(STORAGE_PREFIX + tableKey);
        return next;
      });
    },
    // `alwaysVisible` is expected to be a module-level constant per table.
    [tableKey]
  );

  return { isVisible, toggle, hiddenIds: hidden };
}
