// Year-scoped filter row above the Gesamt-tab content. Affects the KPI
// cards, the activity chart highlight, the heatmap year, and the per-
// domain summary cards' year-scoped subtitle / delta badge.
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";

interface Props {
  years: number[];
  selectedYear: number | null;
  setSelectedYear: (year: number | null) => void;
  compareYear: number | null;
  setCompareYear: (year: number) => void;
  compareEnabled: boolean;
  setCompareEnabled: (enabled: boolean) => void;
}

export default function CrossDomainYearFilter({
  years,
  selectedYear,
  setSelectedYear,
  compareYear,
  setCompareYear,
  compareEnabled,
  setCompareEnabled,
}: Props): JSX.Element {
  const { t } = useTranslation(["stats"]);
  return (
    <div
      className="rounded-lg p-4 flex flex-wrap items-center gap-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="text-xs uppercase tracking-widest font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          {t("stats:overviewFilter.range")}
        </span>
        <YearPill
          label={t("stats:overviewFilter.allYears")}
          active={selectedYear === null}
          onClick={(): void => setSelectedYear(null)}
        />
        {years.map((y) => (
          <YearPill
            key={y}
            label={String(y)}
            active={selectedYear === y}
            onClick={(): void => setSelectedYear(y)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <label
          className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none"
          style={{ color: "var(--text-secondary)" }}
        >
          <input
            type="checkbox"
            checked={compareEnabled}
            disabled={selectedYear === null}
            onChange={(e): void => setCompareEnabled(e.target.checked)}
          />
          {t("stats:overviewFilter.compareWith")}
        </label>
        <select
          className="text-xs rounded-sm border px-2 py-1 font-mono"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--color-border)",
            color: "var(--text-primary)",
          }}
          value={compareYear ?? ""}
          disabled={!compareEnabled || selectedYear === null}
          onChange={(e): void => setCompareYear(Number(e.target.value))}
        >
          {years
            .filter((y) => y !== selectedYear)
            .map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}

function YearPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1 rounded-full text-xs font-mono border transition-colors"
      style={{
        background: active ? "var(--accent)" : "var(--bg-elevated)",
        color: active ? "var(--bg-base)" : "var(--text-secondary)",
        borderColor: active ? "var(--accent)" : "var(--color-border)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
