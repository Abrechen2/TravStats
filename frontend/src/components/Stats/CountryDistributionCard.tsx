import { useState, useEffect } from "react";
import { statsApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import type { CountryStat } from "../../types";
import { logger } from "../../lib/logger";

const MAX_ROWS = 15;

export default function CountryDistributionCard(): JSX.Element {
  const { t } = useTranslation("stats");
  const [countries, setCountries] = useState<CountryStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    statsApi
      .getCountryStats()
      .then((data) => setCountries(data.countries.slice(0, MAX_ROWS)))
      .catch((err) => logger.error("Failed to load country stats:", err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-sm text-gray-500">{t("stats:countryDist.loading")}</p>;
  }

  if (countries.length === 0) {
    return <p className="text-sm text-gray-500">{t("stats:countryDist.noData")}</p>;
  }

  const maxCount = countries[0].count;

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">{t("stats:countryDist.title")}</h3>
      <div className="space-y-1.5">
        {countries.map((row) => (
          <div key={row.country} className="flex items-center gap-3">
            <div className="flex-1 rounded-full h-5 overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(row.count / maxCount) * 100}%`, background: "var(--accent)" }}
              />
            </div>
            <span className="w-36 text-sm truncate" title={row.country}>
              {row.country}
            </span>
            <span className="w-8 text-right text-sm font-semibold">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
