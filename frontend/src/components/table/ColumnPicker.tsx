import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { ColumnPrefs } from "./useColumnPrefs";

export interface PickableColumn {
  id: string;
  /** Already-translated column label — the picker shows what the header shows. */
  label: string;
  /** Not offered for hiding (identity columns like the name). */
  always?: boolean;
}

interface ColumnPickerProps {
  columns: readonly PickableColumn[];
  prefs: ColumnPrefs;
}

/**
 * "Spalten ▾" dropdown shared by the domain list tables — one checkbox per
 * column, identity columns pinned. Same visual idiom as the other toolbar
 * controls (bordered button, elevated dropdown).
 */
export function ColumnPicker({ columns, prefs }: ColumnPickerProps): JSX.Element {
  const { t } = useTranslation(["common"]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" data-testid="column-picker">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
      >
        {t("common:table.columns")} ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-[var(--color-border)] p-2 shadow-lg"
          style={{ background: "var(--bg-elevated)" }}
        >
          {columns.map((col) => (
            <label
              key={col.id}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                col.always
                  ? "cursor-not-allowed text-[var(--text-muted)]"
                  : "cursor-pointer text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              }`}
            >
              <input
                type="checkbox"
                checked={col.always || prefs.isVisible(col.id)}
                disabled={col.always}
                onChange={() => prefs.toggle(col.id)}
                data-testid={`column-toggle-${col.id}`}
              />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
