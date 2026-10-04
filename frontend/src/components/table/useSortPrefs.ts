import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../lib/logger";
import { emitLocalPrefWrite, useWebPrefsEpoch } from "../../lib/webPrefs/prefEvents";

/**
 * Per-table sort choice, persisted to localStorage.
 *
 * Sibling of `useColumnPrefs`, and deliberately the same shape: the column
 * choice has been remembered across reloads for a while, the sort never was.
 * A tester reported it directly — "die Spaltensortierung sollte gespeichert
 * werden und nicht bei jedem Neuladen wieder auf 'Name' zurückspringen"
 * (#dev-talk, 2026-08-22) — and it is the kind of thing that reads as the app
 * forgetting what you told it.
 *
 * The stored key is validated against the caller's own vocabulary on read, so
 * a sort column removed in a later release falls back to the default instead
 * of leaving the table sorted by something that no longer exists.
 *
 * Follows the user across browsers (forgejo#200, `lib/webPrefs/registry.ts`).
 */

export const TABLE_SORT_PREFIX = "travstats:table-sort:";
const STORAGE_PREFIX = TABLE_SORT_PREFIX;

interface StoredSort {
  by: string;
  order: "asc" | "desc";
}

function read(key: string): StoredSort | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { by, order } = parsed as Partial<StoredSort>;
    if (typeof by !== "string") return null;
    if (order !== "asc" && order !== "desc") return null;
    return { by, order };
  } catch (err) {
    logger.warn("useSortPrefs: unreadable preference, starting fresh", err);
    return null;
  }
}

export interface SortPrefs<K extends string> {
  sortBy: K;
  sortOrder: "asc" | "desc";
  /** Sets both at once — what a column header click resolves to. */
  setSort: (by: K, order: "asc" | "desc") => void;
}

export function useSortPrefs<K extends string>(
  tableKey: string,
  defaultBy: K,
  defaultOrder: "asc" | "desc",
  /** The columns this table can sort by; anything else in storage is ignored. */
  known: readonly K[]
): SortPrefs<K> {
  const resolve = (): StoredSort => {
    const stored = read(tableKey);
    if (stored && (known as readonly string[]).includes(stored.by)) return stored;
    return { by: defaultBy, order: defaultOrder };
  };
  const [state, setState] = useState<StoredSort>(resolve);

  // The server's copy arrived after mount: sort by it (forgejo#200).
  const syncEpoch = useWebPrefsEpoch("tablePrefs");
  const seenEpoch = useRef(syncEpoch);
  useEffect(() => {
    if (seenEpoch.current === syncEpoch) return;
    seenEpoch.current = syncEpoch;
    setState(resolve());
    // `resolve` reads tableKey (listed) and the caller's module-constant defaults.
  }, [syncEpoch, tableKey]);

  const setSort = useCallback(
    (by: K, order: "asc" | "desc") => {
      const next: StoredSort = { by, order };
      setState(next);
      try {
        localStorage.setItem(STORAGE_PREFIX + tableKey, JSON.stringify(next));
      } catch (err) {
        // Storage full or disabled: the table still sorts, it just forgets.
        logger.warn("useSortPrefs: could not persist the sort choice", err);
      }
      emitLocalPrefWrite(STORAGE_PREFIX + tableKey);
    },
    [tableKey]
  );

  return { sortBy: state.by as K, sortOrder: state.order, setSort };
}
