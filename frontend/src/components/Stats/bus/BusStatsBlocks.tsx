import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../../hooks/useTranslation";
import type { BusRanked, BusStats } from "../../../types/bus";
import type { SectionVisibility } from "../../../hooks/useSectionVisibility";
import StatCard from "../StatCard";
import RankedBarList, { type RankedRow } from "../lodging/RankedBarList";
import CountingHelp from "../counting/CountingHelp";

/**
 * The bus tab below its key figures (forgejo#263): rankings, connections and
 * new destinations, delays, the longest ride and rides per year — split from
 * `BusStatsSection` so each file reads in one sitting. Counts nothing.
 */
export default function BusStatsBlocks({
  stats,
  year,
  accent,
  visibility,
}: {
  stats: BusStats;
  year: number | null;
  accent: string;
  visibility: SectionVisibility;
}): JSX.Element {
  const { t, i18n } = useTranslation(["bus"]);
  const locale = i18n.language.startsWith("de") ? "de-DE" : "en-GB";
  const num = (n: number): string => n.toLocaleString(locale, { maximumFractionDigits: 0 });
  const show = visibility.isVisible;

  const toRows = (ranked: BusRanked[], label = (l: string): string => l): RankedRow[] => {
    const max = Math.max(...ranked.map((r) => r.count), 1);
    return ranked.map((r) => ({
      key: r.label,
      label: label(r.label),
      weight: r.count / max,
      value: String(r.count),
    }));
  };
  const kindLabel = (kind: string): string =>
    kind === "unknown" ? t("bus:stats.kindUnknown") : t(`bus:kind.${kind}`);
  const { delays, longest } = stats;
  const delayMax = Math.max(...delays.buckets.map((b) => b.count), 1);
  const delayRows: RankedRow[] = delays.buckets.map((b, i) => {
    const lower = i === 0 ? null : delays.buckets[i - 1].upToMinutes;
    return {
      key: String(b.upToMinutes ?? "open"),
      label:
        b.upToMinutes === 0
          ? t("bus:stats.delayOnTime")
          : b.upToMinutes === null
            ? t("bus:stats.delayOver", { minutes: lower ?? 0 })
            : t("bus:stats.delayUpTo", { minutes: b.upToMinutes }),
      weight: b.count / delayMax,
      value: String(b.count),
    };
  });
  const favouriteRows: RankedRow[] = stats.favouriteConnections.map((c) => ({
    key: c.latestRideId,
    label: (
      <Link to={`/bus/${c.latestRideId}`} className="hover:underline">
        {c.from} – {c.to}
      </Link>
    ),
    weight: c.rides,
    value: String(c.rides),
  }));
  const destinationRows: RankedRow[] = [...stats.newDestinations.byYear].reverse().map((y) => ({
    key: String(y.year),
    label: String(y.year),
    weight: y.count,
    value: String(y.count),
  }));
  const yearRows: RankedRow[] = [...stats.byYear].reverse().map((y) => ({
    key: String(y.year),
    label: String(y.year),
    weight: y.rides,
    value: String(y.rides),
    // Unknown stays unknown (review I4): no "0 km" for a year of unmeasured rides.
    hint: [
      y.km === null ? null : `${num(y.km)} km`,
      (y.unmeasured ?? 0) > 0 ? t("bus:stats.kmUnmeasured", { count: y.unmeasured }) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  return (
    <>
      {show("rankings") && (
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3" data-testid="bus-rankings">
          <RankedBarList
            title={t("bus:stats.operators")}
            rows={toRows(stats.operators)}
            accent={accent}
            emptyLabel={t("bus:stats.noOperators")}
          />
          <RankedBarList
            title={t("bus:stats.rideKinds")}
            rows={toRows(stats.rideKinds, kindLabel)}
            accent={accent}
            emptyLabel={t("bus:stats.noRideKinds")}
          />
          <RankedBarList
            title={t("bus:stats.terminals")}
            rows={toRows(stats.terminals)}
            accent={accent}
            emptyLabel={t("bus:stats.noTerminals")}
          />
        </div>
      )}
      {show("connections") && (
        <div className="mt-8" data-testid="bus-connections">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <RankedBarList
              title={t("bus:stats.favouriteConnections")}
              rows={favouriteRows}
              accent={accent}
              emptyLabel={t("bus:stats.noFavouriteConnections")}
            />
            <RankedBarList
              title={t("bus:stats.newDestinations")}
              total={t("bus:stats.newDestinationsInScope", {
                count: stats.newDestinations.inScope,
              })}
              rows={destinationRows}
              accent={accent}
              emptyLabel={t("bus:stats.noNewDestinations")}
            />
          </div>
          <CountingHelp
            entries={[
              {
                term: t("bus:stats.favouriteConnections"),
                helpKey: "bus:stats.help.favourites",
              },
              { term: t("bus:stats.newDestinations"), helpKey: "bus:stats.help.newDestinations" },
            ]}
          />
        </div>
      )}
      {show("delays") && (
        <div className="mt-8" data-testid="bus-delays">
          <RankedBarList
            title={t("bus:stats.delays")}
            total={t("bus:stats.sample", { count: delays.recordedRides, total: stats.rides })}
            rows={delays.recordedRides > 0 ? delayRows : []}
            accent={accent}
            emptyLabel={t("bus:stats.noDelays")}
          />
          <CountingHelp
            entries={[{ term: t("bus:stats.delays"), helpKey: "bus:stats.help.delays" }]}
          />
        </div>
      )}
      {show("records") && longest && (
        <div className="mt-8">
          <StatCard
            accent={accent}
            valueSize="sm"
            title={t("bus:stats.longest")}
            value={
              <Link to={`/bus/${longest.id}`} className="hover:underline">
                {longest.depStationName} → {longest.arrStationName}
              </Link>
            }
            description={`${num(longest.distanceKm)} km · ${t(
              longest.distanceSource === "route"
                ? "bus:stats.sourceRoute"
                : longest.distanceSource === "user"
                  ? "bus:stats.sourceTicket"
                  : "bus:stats.sourceStraight"
            )}`}
          />
        </div>
      )}
      {show("years") && year === null && yearRows.length > 1 && (
        <div className="mt-8">
          <RankedBarList
            title={t("bus:stats.byYear")}
            rows={yearRows}
            accent={accent}
            emptyLabel={t("bus:stats.empty")}
          />
        </div>
      )}
    </>
  );
}
