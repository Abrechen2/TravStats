/**
 * Evidence measures — the cruise insights section (forgejo#257): the special
 * events per voyage, new ports and ports seen again, time in port, shore
 * excursions and port days. Each is folded by `services/stats/cruiseInsights/`
 * and the resolver walks the same fold, cruise by cruise.
 *
 * MIRRORED at `frontend/src/shared/evidenceMeasuresCruiseInsights.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const insight = (aggregation: "sum" | "distinct", unit: string): MeasureSpec => ({
  aggregation,
  unit,
  scopes: ["allTime", "year"],
  surface: "CruiseInsightsSection",
  calculator:
    "services/evidence/metricEvidenceCruiseInsights.ts over services/stats/cruiseInsights/",
  servedIn: 1,
});

export const CRUISE_INSIGHT_MEASURES: Record<string, MeasureSpec> = {
  /** Ports first called at in the scope — every sailed cruise is the reference. */
  cruiseNewPortsCount: insight("distinct", "ports"),
  /** Ports of a cruise already called at on an earlier one, once per cruise. */
  cruisePortRevisitCount: insight("sum", "ports"),
  /** Port calls with arrival and departure both known to the minute. */
  cruiseMeasuredPortStayCount: insight("sum", "portCalls"),
  /** Port calls with an excursion note or a linked day tour. */
  cruiseDocumentedExcursionCount: insight("sum", "portCalls"),
  /** Itinerary days with at least one port call. */
  cruisePortDaysTotal: insight("sum", "days"),
  cruiseEquatorCruiseCount: insight("sum", "cruises"),
  cruiseDatelineCruiseCount: insight("sum", "cruises"),
  cruiseBirthdayAtSeaCruiseCount: insight("sum", "cruises"),
  cruiseNewYearAtSeaCruiseCount: insight("sum", "cruises"),
  cruiseCanalCruiseCount: insight("sum", "cruises"),
  cruisePolarCruiseCount: insight("sum", "cruises"),
};
