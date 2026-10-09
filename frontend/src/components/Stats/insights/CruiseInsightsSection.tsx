import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import StatsSectionsLoadError from "../StatsSectionsLoadError";
import { useTranslation } from "../../../hooks/useTranslation";
import { statsApi } from "../../../lib/api";
import { logger } from "../../../lib/logger";
import type { CruiseInsights } from "../../../types/cruiseInsights";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import CruiseEventsBlock from "./CruiseEventsBlock";
import CruisePortsBlock from "./CruisePortsBlock";
import CruisePortStaysBlock from "./CruisePortStaysBlock";
import CruiseExcursionsBlock from "./CruiseExcursionsBlock";
import CruiseDayPatternBlock from "./CruiseDayPatternBlock";

/**
 * The cruise insights (forgejo#257) — its own request, like the flight
 * insights. Every figure is `GET /stats/cruise-insights`; this side adds the
 * reader's language, the help behind each block and the links: counts open
 * the evidence panel under the tab's own year, single voyages link the cruise.
 */
export default function CruiseInsightsSection({ year }: { year: number | null }): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const [insights, setInsights] = useState<CruiseInsights | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback((): void => {
    setFailed(false);
    statsApi
      .getCruiseInsights(year)
      .then(setInsights)
      .catch((err) => {
        setInsights(null);
        setFailed(true);
        logger.error("Failed to load cruise insights:", err);
      });
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  const scope: EvidenceScopeParams =
    year === null ? { period: "allTime" } : { period: "year", year };
  const muted = { color: "var(--text-muted)" };

  return (
    <section className="mt-8" aria-labelledby="cruise-insights-heading">
      <h2
        id="cruise-insights-heading"
        className="mb-2 text-2xl font-bold"
        style={{ color: "var(--text-primary)" }}
      >
        {t("stats:insights.cruise.title")}
      </h2>
      {failed && <StatsSectionsLoadError onRetry={load} />}
      {!failed && insights === null && (
        <p className="text-sm" style={muted}>
          {t("common:loading.default")}
        </p>
      )}
      {!failed && insights !== null && insights.cruises === 0 && (
        <p className="text-sm" style={muted}>
          {t("stats:insights.cruise.empty")}
        </p>
      )}
      {!failed && insights !== null && insights.cruises > 0 && (
        <div className="space-y-6">
          <p className="text-sm" style={muted}>
            {t("stats:insights.cruise.intro")}
          </p>
          <CruiseEventsBlock events={insights.events} scope={scope} />
          <CruisePortsBlock ports={insights.ports} itineraries={insights.repeatedItineraries} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <CruisePortStaysBlock stays={insights.portStays} scope={scope} />
            <CruiseDayPatternBlock pattern={insights.dayPattern} />
          </div>
          <CruiseExcursionsBlock excursions={insights.excursions} scope={scope} />
        </div>
      )}
    </section>
  );
}
