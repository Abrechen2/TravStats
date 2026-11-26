import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX, KeyboardEvent } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { useIsPhoneViewport } from "../../hooks/useIsPhoneViewport";

export interface YearOption {
  year: number;
  /** Entries in that year. Absent where the page holds no count. */
  count?: number;
}

export type YearValue = number | "all";

interface Props {
  years: ReadonlyArray<YearOption>;
  value: YearValue;
  onChange: (value: YearValue) => void;
  /** "9 Reisen" — the small caption under a year in the grid. */
  formatCount?: (count: number) => string;
  /** Leave out to hide the "all years" entry (a page that always needs a year). */
  allowAll?: boolean;
  /** Greys the whole pill out (e.g. a comparison year while comparing is off). */
  disabled?: boolean;
  /** Accessible name of the whole control. */
  label?: string;
  className?: string;
  /** "dark" for the map panel, which is a dark glass pane in both themes. */
  tone?: "theme" | "dark";
}

const GRID_COLUMNS = 5;

/** Re-points the tokens the picker reads, for a surface that is dark in light mode too. */
const DARK_TONE: CSSProperties = {
  ["--ts-surface" as string]: "rgb(30, 34, 44)",
  ["--ts-border" as string]: "rgba(255, 255, 255, 0.12)",
  ["--ts-text-bright" as string]: "rgba(241, 245, 249, 0.95)",
  ["--ts-accent-text" as string]: "rgb(24, 24, 27)",
};
const GRID_WIDTH_PX = 340;

/**
 * The one year control of the app: a compact pill "‹ 2026 ›".
 *
 * The arrows step through the years that HAVE data (a year without data is
 * not a stop), a click on the year opens a grid of all of them. Replaces the
 * rows of year buttons that grew every January and the dropdowns (owner,
 * 2026-11-26, variant B). Touch targets follow the pointer (`useCoarsePointer`),
 * the popover becomes a bottom sheet on a phone-width viewport.
 */
export default function YearPicker({
  years,
  value,
  onChange,
  formatCount,
  allowAll = true,
  disabled = false,
  tone = "theme",
  label,
  className,
}: Props): JSX.Element {
  const { t } = useTranslation(["common"]);
  const coarse = useCoarsePointer();
  const phone = useIsPhoneViewport();
  const [open, setOpen] = useState<boolean>(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const gridId = useId();

  const ascending = useMemo(() => [...years].sort((a, b) => a.year - b.year), [years]);
  const newestFirst = useMemo(() => [...ascending].reverse(), [ascending]);
  const index = value === "all" ? -1 : ascending.findIndex((y) => y.year === value);
  // From "all", ‹ goes to the newest year; there is no later one to step to.
  const prevYear =
    index > 0 ? ascending[index - 1] : index === -1 ? ascending[ascending.length - 1] : undefined;
  const nextYear = index >= 0 && index < ascending.length - 1 ? ascending[index + 1] : undefined;
  const size = coarse ? 44 : 32;

  const close = useCallback((): void => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    // Capture phase, and stopped: inside a dialog the same Escape would
    // otherwise also close the dialog and drop what the reader had entered.
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  // Cells in tab order: "all" first (when offered), then newest to oldest.
  const cells: YearValue[] = useMemo(
    () => [...(allowAll ? (["all"] as YearValue[]) : []), ...newestFirst.map((y) => y.year)],
    [allowAll, newestFirst]
  );

  useEffect(() => {
    if (!open) return;
    const at = Math.max(0, cells.indexOf(value));
    cellRefs.current[at]?.focus();
  }, [open, cells, value]);

  const choose = (v: YearValue): void => {
    onChange(v);
    close();
    triggerRef.current?.focus();
  };

  // Fixed, measured from the pill: a list filter row scrolls sideways on a
  // narrow screen, and an absolutely placed popover inside it is clipped.
  const toggle = (): void => {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      setAnchor({
        top: rect.bottom + 8,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - GRID_WIDTH_PX - 8)),
      });
    }
    setOpen((o) => !o);
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const current = cellRefs.current.findIndex((el) => el === document.activeElement);
    if (current === -1) return;
    // "all" sits on its own row on top, so the grid proper starts after it.
    const offset = allowAll ? 1 : 0;
    let next: number;
    if (e.key === "ArrowRight") next = current + 1;
    else if (e.key === "ArrowLeft") next = current - 1;
    else if (e.key === "ArrowDown") next = current < offset ? offset : current + GRID_COLUMNS;
    else if (e.key === "ArrowUp") {
      next = current - GRID_COLUMNS;
      if (next < offset) next = offset > 0 && current >= offset ? 0 : current;
    } else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = cells.length - 1;
    else return;
    e.preventDefault();
    if (next < 0 || next >= cells.length) return;
    cellRefs.current[next]?.focus();
  };

  const stepStyle = (disabled: boolean): CSSProperties => ({
    width: size,
    height: size,
    color: "var(--ts-text-bright)",
    opacity: disabled ? 0.35 : 1,
    cursor: disabled ? "default" : "pointer",
  });

  const text = value === "all" ? t("common:yearPicker.all") : String(value);

  const grid = (
    <div
      id={gridId}
      role="group"
      aria-label={t("common:yearPicker.gridLabel")}
      onKeyDown={onGridKey}
      className={
        phone
          ? "fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border p-4"
          : "fixed z-50 rounded-xl border p-3 shadow-lg"
      }
      style={{
        background: "var(--ts-surface)",
        borderColor: "var(--ts-border)",
        minWidth: phone ? undefined : GRID_WIDTH_PX - 20,
        top: phone ? undefined : anchor?.top,
        left: phone ? undefined : anchor?.left,
        maxHeight: phone ? "70vh" : undefined,
        overflowY: "auto",
      }}
    >
      {allowAll && (
        <button
          type="button"
          ref={(el): void => {
            cellRefs.current[0] = el;
          }}
          aria-pressed={value === "all"}
          onClick={(): void => choose("all")}
          className="mb-2 w-full rounded-lg border px-3 text-sm font-semibold"
          style={cellStyle(value === "all", coarse ? 44 : 32)}
        >
          {t("common:yearPicker.all")}
        </button>
      )}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)` }}>
        {newestFirst.map((y, i) => {
          const at = i + (allowAll ? 1 : 0);
          return (
            <button
              key={y.year}
              type="button"
              ref={(el): void => {
                cellRefs.current[at] = el;
              }}
              aria-pressed={value === y.year}
              onClick={(): void => choose(y.year)}
              className="flex flex-col items-center justify-center rounded-lg border px-1 text-sm font-semibold"
              style={cellStyle(value === y.year, coarse ? 44 : 40)}
            >
              <span>{y.year}</span>
              {y.count !== undefined && formatCount && (
                <span className="text-[10px] font-normal opacity-70">{formatCount(y.count)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={label ?? t("common:yearPicker.label")}
      className={`relative inline-flex ${className ?? ""}`}
      style={tone === "dark" ? DARK_TONE : undefined}
    >
      <div
        className="inline-flex items-center rounded-full border"
        style={{ background: "var(--ts-surface)", borderColor: "var(--ts-border)" }}
      >
        <button
          type="button"
          aria-label={t("common:yearPicker.previous")}
          disabled={disabled || !prevYear}
          onClick={(): void => prevYear && onChange(prevYear.year)}
          className="rounded-full"
          style={stepStyle(!prevYear)}
        >
          ‹
        </button>
        <button
          type="button"
          ref={triggerRef}
          disabled={disabled}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? gridId : undefined}
          aria-label={`${t("common:yearPicker.open")}: ${text}`}
          onClick={toggle}
          className="px-3 text-sm font-semibold tabular-nums"
          style={{ minHeight: size, color: "var(--ts-text-bright)" }}
        >
          {text}
        </button>
        <button
          type="button"
          aria-label={t("common:yearPicker.next")}
          disabled={disabled || !nextYear}
          onClick={(): void => nextYear && onChange(nextYear.year)}
          className="rounded-full"
          style={stepStyle(!nextYear)}
        >
          ›
        </button>
      </div>
      {open && grid}
    </div>
  );
}

function cellStyle(active: boolean, minHeight: number): CSSProperties {
  return {
    minHeight,
    background: active ? "var(--ts-accent)" : "transparent",
    borderColor: active ? "var(--ts-accent)" : "var(--ts-border)",
    color: active ? "var(--ts-accent-text)" : "var(--ts-text-bright)",
  };
}
