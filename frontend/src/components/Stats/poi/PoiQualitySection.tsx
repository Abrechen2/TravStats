import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { PoiStatsDetail } from "../../../lib/stats/poiStatsDetail";
import StatCard from "../StatCard";
import RankedBarList, { type RankedRow } from "../lodging/RankedBarList";

interface Props {
  detail: PoiStatsDetail;
  accent: string;
}

const MAX_RATING = 5;

/**
 * What was worth going back for — the ratings people leave on a visit.
 *
 * ONLY RATED VISITS COUNT. An unrated visit is not a zero and must not drag an
 * average down: most visits carry no rating at all, and treating silence as
 * "nought out of five" would make every collection look miserable. The section
 * says how many of the visits are actually rated, so the average can be read
 * for what it is.
 */
export default function PoiQualitySection({ detail, accent }: Props): JSX.Element | null {
  const { t } = useTranslation(["places", "common"]);

  if (detail.ratedVisits === 0 || detail.averageRating === null) return null;

  const rows: RankedRow[] = detail.bestRated.map((r, index) => ({
    key: `${r.placeId}-${index}`,
    label: r.name,
    weight: r.rating / MAX_RATING,
    value: "★".repeat(Math.round(r.rating)),
  }));

  const share = Math.round((detail.ratedVisits / detail.visitsTotal) * 100);

  return (
    <section className="mt-8">
      <h2 className="mb-6 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("places:stats.quality.title")}
      </h2>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent={accent}
          valueSize="md"
          title={t("places:stats.quality.average")}
          value={detail.averageRating.toFixed(1)}
          description={t("places:stats.quality.averageDesc", {
            rated: detail.ratedVisits,
            total: detail.visitsTotal,
            share,
          })}
        />
        <div className="lg:col-span-3">
          <RankedBarList
            title={t("places:stats.quality.bestRated")}
            rows={rows}
            accent={accent}
            emptyLabel={t("places:stats.quality.noRatings")}
          />
        </div>
      </div>
    </section>
  );
}
