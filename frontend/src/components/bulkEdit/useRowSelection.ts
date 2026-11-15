import { useCallback, useState } from "react";

/** What the bulk edit needs of a list row, whatever the domain calls its own type. */
export interface BulkRow {
  id: string;
  /** What the list shows for the row — used by the failure list. */
  label: string;
  /** The row's `updatedAt`: the version the edit is conditioned on. */
  updatedAt?: string;
  tripId?: string | null;
  tags?: string[];
  companions?: string[];
  status?: string;
  operator?: string | null;
  serviceClass?: string | null;
}

export interface RowSelection {
  /** Whether the list shows its checkboxes at all. */
  selecting: boolean;
  start: () => void;
  /** Leaves selection mode and forgets the selection. */
  stop: () => void;
  selected: ReadonlyMap<string, BulkRow>;
  isSelected: (id: string) => boolean;
  /** Every one of `rows` is chosen (a rail entry with changes is several rows). */
  allSelected: (rows: readonly BulkRow[]) => boolean;
  /** Selects `rows`, or deselects them when they all are already. */
  toggle: (rows: readonly BulkRow[]) => void;
  selectAll: (rows: readonly BulkRow[]) => void;
  clear: () => void;
  /** Replaces chosen rows with fresher copies (after the list reloaded). */
  refresh: (rows: readonly BulkRow[]) => void;
}

/**
 * An EXPLICIT selection for the bulk edit (forgejo#405 A4, the flights' pattern
 * of forgejo#217): nothing is selected by a filter or a page, only by ticks.
 * The rows keep their objects so the preview can count what each one has today.
 */
export function useRowSelection(): RowSelection {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlyMap<string, BulkRow>>(new Map());
  const toggle = useCallback((rows: readonly BulkRow[]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (rows.every((r) => next.has(r.id))) for (const r of rows) next.delete(r.id);
      else for (const r of rows) next.set(r.id, r);
      return next;
    });
  }, []);
  const selectAll = useCallback((rows: readonly BulkRow[]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of rows) next.set(r.id, r);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Map()), []);
  const start = useCallback(() => setSelecting(true), []);
  const stop = useCallback(() => {
    setSelecting(false);
    setSelected(new Map());
  }, []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);
  const allSelected = useCallback(
    (rows: readonly BulkRow[]) => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [selected]
  );
  const refresh = useCallback((rows: readonly BulkRow[]) => {
    setSelected((prev) => {
      if (prev.size === 0 || !rows.some((r) => prev.has(r.id))) return prev;
      const next = new Map(prev);
      for (const r of rows) if (next.has(r.id)) next.set(r.id, r);
      return next;
    });
  }, []);
  return {
    selecting,
    start,
    stop,
    selected,
    isSelected,
    allSelected,
    toggle,
    selectAll,
    clear,
    refresh,
  };
}
