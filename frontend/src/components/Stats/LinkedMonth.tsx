import { useCallback, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { monthFromSearch, yearFromSearch } from "../../lib/stats/yearLinks";

const MONTH_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

/**
 * `?year=&month=` on a list (a statistics year card's month): the month the link named, held
 * only while the list's year filter still shows that year — picking another year drops it, so a
 * filter can never outlive the year it was cut from. It has no select of its own, so
 * `LinkedMonthChip` names it and clears it (a filter nobody can see makes a list look as if it
 * lost data).
 */
export function useLinkedMonth(yearFilter: number | "all"): {
  month: number | null;
  clear: () => void;
} {
  const [linked, setLinked] = useState<{ year: number; month: number } | null>(() => {
    const year = yearFromSearch(window.location.search);
    const month = monthFromSearch(window.location.search);
    return year !== null && month !== null ? { year, month } : null;
  });
  const clear = useCallback((): void => setLinked(null), []);
  return { month: linked !== null && linked.year === yearFilter ? linked.month : null, clear };
}

export function LinkedMonthChip({
  month,
  year,
  onClear,
}: {
  month: number | null;
  year: number | "all";
  onClear: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["stats"]);
  if (month === null || year === "all") return null;
  return (
    <p
      className="mb-3 flex flex-wrap items-center gap-2 text-sm"
      data-testid="linked-month-chip"
      style={{ color: "var(--text-muted)" }}
    >
      {t("stats:years.linkedMonth", { month: t(`stats:months.${MONTH_KEYS[month - 1]}`), year })}
      <button
        type="button"
        onClick={onClear}
        className="underline"
        style={{ color: "var(--accent)" }}
      >
        {t("stats:years.linkedMonthClear")}
      </button>
    </p>
  );
}
