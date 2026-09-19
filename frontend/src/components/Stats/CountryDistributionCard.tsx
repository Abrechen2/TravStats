import { useTranslation } from "../../hooks/useTranslation";
import type { CountryStatsResponse } from "../../types";
import EvidenceTrigger from "./EvidenceTrigger";
import { rankingKey } from "../../shared/evidence";

const MAX_ROWS = 15;

export interface CountryDistributionCardProps {
  /**
   * The country distribution, loaded by the page (forgejo#49). This card and
   * `useDomainStats` each fetched `/stats/countries` separately, so the flight
   * tab asked the same question twice per load; the page now reads it once,
   * from `/stats/page`. `undefined` means the load has not finished.
   */
  countries: CountryStatsResponse | undefined;
}

export default function CountryDistributionCard({
  countries: data,
}: CountryDistributionCardProps): JSX.Element {
  const { t } = useTranslation("stats");

  if (!data) {
    return <p className="text-sm text-gray-500">{t("stats:countryDist.loading")}</p>;
  }

  const countries = data.countries.slice(0, MAX_ROWS);
  if (countries.length === 0) {
    return <p className="text-sm text-gray-500">{t("stats:countryDist.noData")}</p>;
  }

  const maxCount = countries[0].count;

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">{t("stats:countryDist.title")}</h3>
      <div className="space-y-1.5">
        {countries.map((row) => (
          <EvidenceTrigger
            key={row.country}
            kind="ranking"
            evidenceKey={rankingKey("country", row.country)}
            scope={{ period: "allTime" }}
            renderedValue={row.count}
            label={row.country}
            className="flex items-center gap-3"
          >
            <div
              className="flex-1 rounded-full h-5 overflow-hidden"
              style={{ background: "var(--bg-elevated)" }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(row.count / maxCount) * 100}%`, background: "var(--accent)" }}
              />
            </div>
            <span className="w-36 text-sm truncate" title={row.country}>
              {row.country}
            </span>
            <span className="w-8 text-right text-sm font-semibold">{row.count}</span>
          </EvidenceTrigger>
        ))}
      </div>
    </div>
  );
}
