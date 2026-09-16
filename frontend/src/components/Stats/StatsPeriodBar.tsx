import { useRef } from "react";
import type { JSX } from "react";
import { useRevealActive } from "../../lib/ui/revealInRow";
import { useTranslation } from "../../hooks/useTranslation";
import type { StatsPeriod } from "./useStatsPeriod";

interface Props {
  /** Every year any enabled domain has data for, ascending. */
  years: number[];
  period: StatsPeriod;
}

/**
 * The one period control of the statistics page, above every tab.
 *
 * There were two, and three tabs without any. The overview drew these pills;
 * the flight tab drew a `<select>` with its own state; cruises, stays and
 * places drew nothing and showed lifetime totals. So the overview could say
 * "no stays in 2026" while the stays tab beside it showed four — both true, and
 * a reader can only conclude that one of them is broken (owner, 2026-09-15).
 *
 * The pills won because they are the newer form and show every year at once.
 * The year list is the union across domains rather than the flight years: a
 * year with only a cruise in it is still a year somebody travelled.
 */
export default function StatsPeriodBar({ years, period }: Props): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const {
    selectedYear,
    setSelectedYear,
    compareYear,
    setCompareYear,
    compareEnabled,
    setCompareEnabled,
  } = period;
  const yearsRef = useRef<HTMLDivElement | null>(null);

  // The chosen year stays in view in the scrolling row — the row only.
  useRevealActive(yearsRef, '[aria-pressed="true"]', [selectedYear, years.join(",")]);

  return (
    <div
      className="rounded-lg p-3 sm:p-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4"
      style={{ background: "var(--ts-surface)", border: "1px solid var(--ts-border)" }}
    >
      <span className="t-label-mono sm:hidden">{t("stats:overviewFilter.range")}</span>
      {/* One row that scrolls sideways on a phone, and wraps where there is
          room. Wrapping on a phone was the long narrow column of B05. */}
      <div
        ref={yearsRef}
        className="flex min-w-0 items-center gap-2 overflow-x-auto scrollbar-none sm:flex-wrap sm:overflow-visible"
      >
        <span className="t-label-mono hidden sm:inline">{t("stats:overviewFilter.range")}</span>
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

      <div className="flex items-center gap-2 sm:ml-auto">
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
          aria-label={t("stats:overviewFilter.compareWith")}
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
      aria-pressed={active}
      className="shrink-0 px-3 py-1 rounded-full text-xs font-mono border transition-colors"
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
