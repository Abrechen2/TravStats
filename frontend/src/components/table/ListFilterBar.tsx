import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * The filter bar above a domain list — one shape for flights, cruises and
 * lodging.
 *
 * The three had drifted into three different answers to the same question.
 * Cruises and lodging each drew their own row of selects, similar but not
 * identical; flights put EVERYTHING (year, status, airlines) behind a popover
 * built for the map, and then hung two rows of chips above the table for trips
 * and special flights — so the flights list was the one place where a filter
 * was a pill rather than a control, and where "which year" took two clicks
 * more than next door.
 *
 * The split the owner asked for: search, status and year stay OPEN, because
 * every domain has them and they are what people reach for. Everything a
 * single domain owns — airlines, months, lodging type, country, special-flight
 * type — sits behind one "Filter" button that carries a count, so the bar
 * stays the same width whatever domain you are standing in.
 */

export interface SelectFilterConfig {
  /** Accessible name; the control shows the selected value, not this. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The "no restriction" entry, always first. */
  allLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

interface Props {
  search: { value: string; onChange: (value: string) => void; placeholder: string };
  status?: SelectFilterConfig;
  year?: SelectFilterConfig;
  /** Domain-specific controls, rendered inside the "Filter" panel. */
  extra?: ReactNode;
  /** How many domain-specific filters are set — drives the button's badge. */
  extraActiveCount?: number;
  hasActiveFilter: boolean;
  onReset: () => void;
  /** Right-hand side, usually "N von M". */
  resultLabel: string;
}

const CONTROL_CLASS =
  "rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]";

function FilterSelect({ config }: { config: SelectFilterConfig }): JSX.Element {
  return (
    <select
      value={config.value}
      onChange={(e): void => config.onChange(e.target.value)}
      aria-label={config.label}
      className={CONTROL_CLASS}
    >
      <option value="all">{config.allLabel}</option>
      {config.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function ListFilterBar({
  search,
  status,
  year,
  extra,
  extraActiveCount = 0,
  hasActiveFilter,
  onReset,
  resultLabel,
}: Props): JSX.Element {
  const { t } = useTranslation(["common"]);
  const [open, setOpen] = useState<boolean>(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Click outside and Escape both close it. The map filter panel handled only
  // the click, so the keyboard left it standing open over the table.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      className="sticky top-14 z-20 px-4 py-3 backdrop-blur-md"
      style={{
        background: "rgba(13,17,23,0.85)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div className="mx-auto flex max-w-(--breakpoint-2xl) flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            type="search"
            value={search.value}
            onChange={(e): void => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            className={`w-full ${CONTROL_CLASS} placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none md:max-w-xs`}
          />
          {status && <FilterSelect config={status} />}
          {year && <FilterSelect config={year} />}

          {extra && (
            <div className="relative" ref={panelRef}>
              <button
                type="button"
                onClick={(): void => setOpen((v) => !v)}
                aria-expanded={open}
                aria-haspopup="dialog"
                data-testid="list-filter-more"
                className={`inline-flex items-center gap-2 ${CONTROL_CLASS} ${
                  extraActiveCount > 0 ? "border-[var(--accent)]" : ""
                }`}
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
                <span>{t("common:filters.more")}</span>
                {extraActiveCount > 0 && (
                  <span
                    data-testid="list-filter-badge"
                    className="flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs"
                    style={{ background: "var(--accent)", color: "var(--bg-base)" }}
                  >
                    {extraActiveCount}
                  </span>
                )}
              </button>

              {open && (
                <div
                  role="dialog"
                  aria-label={t("common:filters.more")}
                  className="absolute left-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg p-4 shadow-xl"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <div className="flex flex-col gap-4">{extra}</div>
                </div>
              )}
            </div>
          )}

          {hasActiveFilter && (
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {t("common:filters.reset")}
            </button>
          )}
        </div>
        <div className="text-xs text-[var(--text-muted)]">{resultLabel}</div>
      </div>
    </div>
  );
}

/** One labelled control inside the "Filter" panel, so they all line up. */
export function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

/** The select styling used inside the panel — full width, unlike the bar. */
export const PANEL_SELECT_CLASS = `w-full ${CONTROL_CLASS}`;
