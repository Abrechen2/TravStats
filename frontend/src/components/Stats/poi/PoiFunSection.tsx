import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { PoiStatsDetail } from "../../../lib/stats/poiStatsDetail";
import StatCard from "../StatCard";

interface Props {
  detail: PoiStatsDetail;
  accent: string;
  locale: string;
}

const formatDate = (iso: string | Date, locale: string): string =>
  new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "2-digit" });

/**
 * The figures that are fun rather than useful — the places counterpart to the
 * flight page's "early bird / night owl / fastest day" block.
 *
 * Each one is a real measurement, not a badge: the first place in the logbook,
 * the one returned to most often, how much of the category catalogue has been
 * used, how far north and south the collection reaches. A card that cannot be
 * computed is not rendered, rather than rendered with an em dash — an absent
 * card reads as "not yet", a dashed one reads as "broken".
 */
export default function PoiFunSection({ detail, accent, locale }: Props): JSX.Element | null {
  const { t } = useTranslation(["places", "common"]);

  const favourite = detail.mostVisited[0];
  const repeatWorthy = favourite && favourite.visits > 1 ? favourite : null;

  const cards: JSX.Element[] = [];

  if (detail.firstVisit) {
    cards.push(
      <StatCard
        key="first"
        accent={accent}
        valueSize="sm"
        title={t("places:stats.fun.firstVisit")}
        value={detail.firstVisit.name}
        description={formatDate(detail.firstVisit.at, locale)}
      />
    );
  }

  if (repeatWorthy) {
    cards.push(
      <StatCard
        key="favourite"
        accent={accent}
        valueSize="sm"
        title={t("places:stats.fun.favourite")}
        value={repeatWorthy.place.name}
        description={t("places:stats.fun.favouriteDesc", { count: repeatWorthy.visits })}
      />
    );
  }

  cards.push(
    <StatCard
      key="categories"
      accent={accent}
      valueSize="md"
      title={t("places:stats.fun.categoryCoverage")}
      value={`${detail.categoryCoverage.used} / ${detail.categoryCoverage.total}`}
      description={
        detail.categoryCoverage.used === detail.categoryCoverage.total
          ? t("places:stats.fun.categoryCoverageComplete")
          : t("places:stats.fun.categoryCoverageDesc", {
              count: detail.categoryCoverage.total - detail.categoryCoverage.used,
            })
      }
    />
  );

  if (detail.northernmost) {
    cards.push(
      <StatCard
        key="north"
        accent={accent}
        valueSize="sm"
        title={t("places:stats.fun.northernmost")}
        value={detail.northernmost.name}
        description={`${detail.northernmost.lat.toFixed(2)}° N`}
      />
    );
  }

  if (detail.southernmost && detail.southernmost.id !== detail.northernmost?.id) {
    cards.push(
      <StatCard
        key="south"
        accent={accent}
        valueSize="sm"
        title={t("places:stats.fun.southernmost")}
        value={detail.southernmost.name}
        description={`${Math.abs(detail.southernmost.lat).toFixed(2)}° ${
          detail.southernmost.lat < 0 ? "S" : "N"
        }`}
      />
    );
  }

  if (detail.visitsOnTrips > 0) {
    cards.push(
      <StatCard
        key="trips"
        accent={accent}
        valueSize="md"
        title={t("places:stats.fun.onTrips")}
        value={detail.visitsOnTrips}
        description={t("places:stats.fun.onTripsDesc", {
          // Out of the visits that exist, not out of the places — a visit is
          // the thing that can belong to a trip.
          total: detail.visitsTotal,
        })}
      />
    );
  }

  if (cards.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-6 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("places:stats.fun.title")}
      </h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">{cards}</div>
    </section>
  );
}
