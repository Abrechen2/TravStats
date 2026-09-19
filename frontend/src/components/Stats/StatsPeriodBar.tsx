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
    // A row of pills on the page, no box around it (round 4).
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
      <span className="t-label-mono sm:hidden">{t("stats:overviewFilter.range")}</span>
      {/* One row that scrolls sideways on a phone, and wraps where there is
          room. Wrapping on a phone was the long narrow column of B05. */}
      <div
        ref={yearsRef}
        className="flex min-w-0 items-center gap-2 overflow-x-auto scrollbar-none sm:flex-wrap sm:overflow-visible"
      >
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
          className="inline-flex items-center gap-1.5 text-sm cursor-pointer select-none"
          style={{ color: "var(--ts-text)" }}
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
          className="rounded-full border px-3 py-1.5 text-sm font-semibold"
          style={{
            background: "var(--ts-surface)",
            borderColor: "var(--ts-border)",
            color: "var(--ts-text-bright)",
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
      className="shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors"
      style={{
        background: active ? "var(--ts-accent)" : "transparent",
        color: active ? "var(--ts-accent-text)" : "var(--ts-text-bright)",
        borderColor: active ? "var(--ts-accent)" : "var(--ts-border)",
      }}
    >
      {label}
    </button>
  );
}
