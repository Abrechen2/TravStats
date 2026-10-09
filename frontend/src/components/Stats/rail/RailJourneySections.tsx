import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../../hooks/useTranslation";
import type { RailJourneyFigures, RailPunctualityRow } from "../../../types/rail";
import type { SectionVisibility } from "../../../hooks/useSectionVisibility";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import StatCard from "../StatCard";
import RankedBarList, { type RankedRow } from "../lodging/RankedBarList";
import MetricHelp from "../MetricHelp";

/**
 * The rail tab's journey-level blocks (forgejo#261): journeys and changes,
 * favourite and new connections, punctuality per operator and per
 * connection. Every figure is the server's (`connected` in `GET /rail/stats`,
 * `services/rail/railJourneyStats.ts`); this file counts nothing.
 *
 * Each block carries its "So wird gezählt" (`MetricHelp`), because three of
 * these figures are easy to misread: a journey is NOT a ride, a connection is
 * BOTH directions, and an operator's share is over the rides that recorded a
 * delay — never over all of them.
 */
export default function RailJourneySections({
  figures,
  rides,
  delaysRecorded,
  year,
  accent,
  visibility,
}: {
  figures: RailJourneyFigures;
  /** Counted rides in the period — the denominator a punctuality sample is read against. */
  rides: number;
  /** Rides with a recorded delay and both clocks — the whole sample, not only the top ten. */
  delaysRecorded: number;
  year: number | null;
  accent: string;
  visibility: SectionVisibility;
}): JSX.Element {
  const { t, i18n } = useTranslation(["rail"]);
  const locale = i18n.language.startsWith("de") ? "de-DE" : "en-GB";
  const num = (n: number, digits = 0): string =>
    n.toLocaleString(locale, { maximumFractionDigits: digits });
  const show = visibility.isVisible;
  const scope: EvidenceScopeParams =
    year === null ? { period: "allTime" } : { period: "year", year };
  const evidence = (key: string, renderedValue: number) => ({
    kind: "metric" as const,
    key,
    scope,
    renderedValue,
  });
  const { journeys, transfers, favouriteConnections, newConnections, punctuality } = figures;

  const minutes = (value: number | null): string =>
    value === null ? "–" : t("rail:stats.minutesValue", { minutes: num(value, 1) });

  const favouriteRows: RankedRow[] = favouriteConnections.map((c) => ({
    key: c.latestRideId,
    label: (
      <Link to={`/rail/${c.latestRideId}`} className="hover:underline">
        {c.from} – {c.to}
      </Link>
    ),
    weight: c.rides,
    value: String(c.rides),
  }));
  const newRows: RankedRow[] = [...newConnections.byYear].reverse().map((y) => ({
    key: String(y.year),
    label: String(y.year),
    weight: y.count,
    value: String(y.count),
  }));
  const punctualityRows = (rows: RailPunctualityRow[]): RankedRow[] =>
    rows.map((r) => ({
      key: r.label,
      label: r.label,
      // The bar is the on-time SHARE of the sample, not the sample's size.
      weight: r.onTime / r.measured,
      value: `${Math.round((r.onTime / r.measured) * 100)} %`,
      hint: t("rail:stats.punctualityHint", {
        count: r.measured,
        average: num(r.averageMinutes, 1),
      }),
    }));

  return (
    <>
      {show("journeys") && (
        <div className="mt-8" data-testid="rail-journeys">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("rail:stats.journeysLinked")}
              value={num(journeys.total)}
              description={t("rail:stats.journeysLinkedDesc", { count: journeys.withTransfer })}
              evidence={evidence("railJourneyCount", journeys.total)}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("rail:stats.transfers")}
              value={minutes(transfers.averageMinutes)}
              description={
                transfers.count === 0
                  ? t("rail:stats.transfersNone")
                  : t("rail:stats.transfersDesc", {
                      count: transfers.count,
                      shortest: minutes(transfers.shortestMinutes),
                      longest: minutes(transfers.longestMinutes),
                    })
              }
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("rail:stats.nightNights")}
              value={num(figures.nightTrainNights.nights)}
              description={
                figures.nightTrainNights.undated > 0
                  ? t("rail:stats.nightNightsUndated", { count: figures.nightTrainNights.undated })
                  : t("rail:stats.nightNightsDesc")
              }
              evidence={evidence("railNightTrainNights", figures.nightTrainNights.nights)}
            />
            <StatCard
              accent={accent}
              valueSize="md"
              title={t("rail:stats.newConnections")}
              value={num(newConnections.inScope)}
              description={t("rail:stats.newConnectionsDesc")}
              evidence={evidence("railNewConnectionsCount", newConnections.inScope)}
            />
          </div>
          <MetricHelp
            testId="rail-journeys-help"
            items={[
              { term: t("rail:stats.journeysLinked"), text: t("rail:stats.help.journeys") },
              { term: t("rail:stats.transfers"), text: t("rail:stats.help.transfers") },
              { term: t("rail:stats.nightNights"), text: t("rail:stats.help.nights") },
              { term: t("rail:stats.newConnections"), text: t("rail:stats.help.newConnections") },
            ]}
          />
        </div>
      )}
      {show("connections") && (
        <div className="mt-8" data-testid="rail-connections">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <RankedBarList
              title={t("rail:stats.favouriteConnections")}
              rows={favouriteRows}
              accent={accent}
              emptyLabel={t("rail:stats.noFavouriteConnections")}
            />
            <RankedBarList
              title={t("rail:stats.newConnectionsByYear")}
              rows={newRows}
              accent={accent}
              emptyLabel={t("rail:stats.noNewConnections")}
            />
          </div>
          <MetricHelp
            items={[
              {
                term: t("rail:stats.favouriteConnections"),
                text: t("rail:stats.help.favourites"),
              },
            ]}
          />
        </div>
      )}
      {show("punctuality") && (
        <div className="mt-8" data-testid="rail-punctuality">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <RankedBarList
              title={t("rail:stats.punctualityByOperator")}
              total={t("rail:stats.sample", {
                count: delaysRecorded,
                total: rides,
              })}
              rows={punctualityRows(punctuality.byOperator)}
              accent={accent}
              emptyLabel={t("rail:stats.noPunctuality")}
            />
            <RankedBarList
              title={t("rail:stats.punctualityByConnection")}
              rows={punctualityRows(punctuality.byConnection)}
              accent={accent}
              emptyLabel={t("rail:stats.noPunctuality")}
            />
          </div>
          <MetricHelp
            items={[
              {
                term: t("rail:stats.punctualityByOperator"),
                text: t("rail:stats.help.punctuality"),
              },
            ]}
          />
        </div>
      )}
    </>
  );
}
