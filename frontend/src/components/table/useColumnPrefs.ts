import { useCallback, useState } from "react";
import { logger } from "../../lib/logger";

/**
 * Per-table column visibility, persisted to localStorage. The stored value is
 * the list of HIDDEN column ids — so a column added in a later release is
 * visible by default instead of silently missing for everyone with an old
 * preference blob. Shared by the flights, cruises and lodging list pages
 * (owner principle: the table pages look the same across domains, only the
 * content differs).
 */

const STORAGE_PREFIX = "travstats:table-hidden-columns:";

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

export function useColumnPrefs(tableKey: string, alwaysVisible: readonly string[] = []): ColumnPrefs {
  const [hidden, setHidden] = useState<string[]>(() => readHidden(tableKey));

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
        return next;
      });
    },
    // `alwaysVisible` is expected to be a module-level constant per table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableKey]
  );

  return { isVisible, toggle, hiddenIds: hidden };
}
