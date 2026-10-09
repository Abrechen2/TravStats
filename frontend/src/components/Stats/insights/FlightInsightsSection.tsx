import { useMemo } from "react";
import type { JSX } from "react";

import StatsSectionsLoadError from "../StatsSectionsLoadError";
import { useLatestLoad } from "./useLatestLoad";
import { useTranslation } from "../../../hooks/useTranslation";
import { statsApi } from "../../../lib/api";
import type { Flight } from "../../../types";
import FlightYearStoryCard from "./FlightYearStoryCard";
import FlightDiscoveryTable from "./FlightDiscoveryTable";
import FlightReunionsBlock from "./FlightReunionsBlock";
import FlightTransfersBlock from "./FlightTransfersBlock";
import { airportNamer } from "./insightFormat";

/**
 * Discoveries, returns and transfers (forgejo#256) — its own component with
 * its own request, like `RecordsSection`: `AdvancedStatsPage` mounts it and
 * knows nothing else about it.
 *
 * NOTHING HERE IS COUNTED. Every figure is `GET /stats/flight-insights`; the
 * page's flights are read for airport NAMES only. What the component adds is
 * the reader's language, the help behind each figure, and the links to the
 * entries: counts open the evidence panel, extremes link their flights.
 */
export default function FlightInsightsSection({
  flights,
  year,
}: {
  /** The page's countable flights — read for airport names only. */
  flights: readonly Flight[];
  /** The page's year pill; picks the story's year. Null: the latest year with flights. */
  year: number | null;
}): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const {
    data: insights,
    failed,
    reload: load,
  } = useLatestLoad(statsApi.getFlightInsights, year, "flight insights");

  const nameOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const f of flights) {
      if (f.depIata && f.depName) names.set(f.depIata.toUpperCase(), f.depName);
      if (f.arrIata && f.arrName) names.set(f.arrIata.toUpperCase(), f.arrName);
    }
    return airportNamer(names);
  }, [flights]);

  const muted = { color: "var(--text-muted)" };

  return (
    <section className="mt-8" aria-labelledby="stats-insights-heading">
      <h2
        id="stats-insights-heading"
        className="mb-2 text-3xl font-bold"
        style={{ color: "var(--text-primary)" }}
      >
        {t("stats:insights.title")}
      </h2>
      {failed && <StatsSectionsLoadError onRetry={load} />}
      {!failed && insights === null && (
        <p className="text-sm" style={muted}>
          {t("common:loading.default")}
        </p>
      )}
      {!failed && insights !== null && insights.history.firstYear === null && (
        <p className="text-sm" style={muted}>
          {t("stats:insights.empty")}
        </p>
      )}
      {!failed && insights !== null && insights.history.firstYear !== null && (
        <>
          <p className="mb-2 text-sm" style={muted}>
            {t("stats:insights.intro", { firstYear: insights.history.firstYear })}
          </p>
          {(insights.history.undatedFlights > 0 ||
            insights.history.placeholderDateFlights > 0 ||
            insights.history.unknownEndFlights > 0) && (
            <p className="mb-6 text-xs" style={muted}>
              {[
                insights.history.undatedFlights > 0 &&
                  t("stats:insights.coverage.undated", {
                    flights: insights.history.undatedFlights,
                  }),
                insights.history.placeholderDateFlights > 0 &&
                  t("stats:insights.coverage.placeholderDate", {
                    flights: insights.history.placeholderDateFlights,
                  }),
                insights.history.unknownEndFlights > 0 &&
                  t("stats:insights.coverage.unknownEnd", {
                    flights: insights.history.unknownEndFlights,
                  }),
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
          )}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FlightYearStoryCard story={insights.story} year={year} nameOf={nameOf} />
            <FlightTransfersBlock transfers={insights.transfers} nameOf={nameOf} />
          </div>
          <FlightDiscoveryTable years={insights.years} />
          <FlightReunionsBlock
            reunions={insights.reunions}
            quarterAirports={insights.quarterAirports}
            nameOf={nameOf}
          />
        </>
      )}
    </section>
  );
}
