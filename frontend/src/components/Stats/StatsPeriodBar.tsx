import type { JSX } from "react";
import YearPicker from "../ui/YearPicker";
import { useTranslation } from "../../hooks/useTranslation";
import type { StatsPeriod } from "./useStatsPeriod";

interface Props {
  /** Every year any enabled domain has data for, ascending. */
  years: number[];
  period: StatsPeriod;
  /** Events per year across the enabled domains; a year without an entry shows no count. */
  counts?: Readonly<Record<number, number>>;
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
export default function StatsPeriodBar({ years, period, counts }: Props): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const {
    selectedYear,
    setSelectedYear,
    compareYear,
    setCompareYear,
    compareEnabled,
    setCompareEnabled,
  } = period;
  const compareYears = years.filter((y) => y !== selectedYear);

  return (
    // A row of pills on the page, no box around it (round 4).
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
      <span className="t-label-mono sm:hidden">{t("stats:overviewFilter.range")}</span>
      <YearPicker
        years={years.map((year) => ({ year, count: counts?.[year] }))}
        formatCount={(n): string => t("common:yearPicker.count.events", { count: n })}
        value={selectedYear ?? "all"}
        onChange={(v): void => setSelectedYear(v === "all" ? null : v)}
        label={t("stats:overviewFilter.range")}
      />

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
        <YearPicker
          years={compareYears.map((year) => ({ year }))}
          value={compareYear ?? compareYears[0] ?? "all"}
          onChange={(v) => {
            if (v !== "all") setCompareYear(v);
          }}
          allowAll={false}
          disabled={!compareEnabled || selectedYear === null}
          label={t("stats:overviewFilter.compareWith")}
        />
      </div>
    </div>
  );
}
