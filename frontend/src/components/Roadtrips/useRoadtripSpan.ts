import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { RoadtripSummary } from "../../types/roadtrip";

/** "18.09. – 28.09.2026", or the undated word. */
export function useRoadtripSpan(): (r: Pick<RoadtripSummary, "startDate" | "endDate">) => string {
  const { t } = useTranslation(["roadtrips"]);
  const display = useDisplayFormat();
  return (r) => {
    if (!r.startDate) return t("roadtrips:undated");
    const to = r.endDate ?? r.startDate;
    if (to.slice(0, 10) === r.startDate.slice(0, 10)) {
      return display.date(r.startDate, { timeZone: "UTC" });
    }
    return `${display.date(r.startDate, { timeZone: "UTC", omitYear: true })} – ${display.date(to, { timeZone: "UTC" })}`;
  };
}
