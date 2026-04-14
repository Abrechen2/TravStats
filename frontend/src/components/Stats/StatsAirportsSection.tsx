import type { AirportStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";

interface StatsAirportsSectionProps {
  airportStats: AirportStats | null;
}

const CONTINENT_LABEL_KEY: Record<string, string> = {
  EU: "stats:airportStats.continent.europe",
  NA: "stats:airportStats.continent.northAmerica",
  SA: "stats:airportStats.continent.southAmerica",
  AS: "stats:airportStats.continent.asia",
  AF: "stats:airportStats.continent.africa",
  OC: "stats:airportStats.continent.oceania",
  Other: "stats:airportStats.continent.other",
};

export default function StatsAirportsSection({
  airportStats,
}: StatsAirportsSectionProps): JSX.Element {
  const { t } = useTranslation(["stats"]);

  if (!airportStats) {
    return (
      <div className="mt-8">
        <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
          {t("stats:airportStats.title")}
        </h2>
        <div
          className="rounded-lg shadow p-6 text-center"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <p style={{ color: "var(--text-muted)" }}>{t("stats:loading")}</p>
        </div>
      </div>
    );
  }

  const {
    airportCount,
    countryCount,
    continentCount,
    topAirports,
    rarestAirports,
    newThisYear,
    farthestFromHome,
    topCountries,
    continentDistribution,
  } = airportStats;

  const continentTotal = Object.values(continentDistribution).reduce((s, v) => s + v, 0);
  const sortedContinents = Object.entries(continentDistribution).sort(([, a], [, b]) => b - a);

  return (
    <div className="mt-8">
      <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:airportStats.title")}
      </h2>

      {/* Counters row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-gradient-to-br from-sky-500 to-indigo-500 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">
            {t("stats:airportStats.airportCount")}
          </h3>
          <p className="text-4xl font-bold mb-1">{airportCount}</p>
          <p className="text-sm opacity-75">{t("stats:airportStats.airportCountDesc")}</p>
        </div>

        <div className="bg-gradient-to-br from-emerald-500 to-teal-500 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">
            {t("stats:airportStats.countryCount")}
          </h3>
          <p className="text-4xl font-bold mb-1">{countryCount}</p>
          <p className="text-sm opacity-75">{t("stats:airportStats.countryCountDesc")}</p>
        </div>

        <div className="bg-gradient-to-br from-fuchsia-500 to-pink-500 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">
            {t("stats:airportStats.continentCount")}
          </h3>
          <p className="text-4xl font-bold mb-1">
            {continentCount}
            <span className="text-xl ml-1 opacity-70">/ 6</span>
          </p>
          <p className="text-sm opacity-75">{t("stats:airportStats.continentCountDesc")}</p>
        </div>
      </div>

      {/* Detail cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Top airports */}
        <div
          className="rounded-lg p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3
            className="text-sm font-semibold mb-3 uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            {t("stats:airportStats.topAirports")}
          </h3>
          {topAirports.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("stats:airportStats.empty")}
            </p>
          ) : (
            <ol className="space-y-2">
              {topAirports.map((a, i) => (
                <li key={a.code} className="flex items-center gap-3">
                  <span
                    className="text-sm font-bold w-6 text-right"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {i + 1}.
                  </span>
                  <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    {a.code}
                  </span>
                  <span className="text-sm flex-1 truncate" style={{ color: "var(--text-muted)" }}>
                    {a.name || "—"}
                  </span>
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {t("stats:airportStats.visits", { count: a.visits })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Top countries */}
        <div
          className="rounded-lg p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3
            className="text-sm font-semibold mb-3 uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            {t("stats:airportStats.topCountries")}
          </h3>
          {topCountries.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("stats:airportStats.empty")}
            </p>
          ) : (
            <ol className="space-y-2">
              {topCountries.map((c, i) => (
                <li key={c.country} className="flex items-center gap-3">
                  <span
                    className="text-sm font-bold w-6 text-right"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {i + 1}.
                  </span>
                  <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    {c.country}
                  </span>
                  <span
                    className="text-sm ml-auto font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {t("stats:airportStats.flightsCount", { count: c.count })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Farthest from home */}
        <div className="bg-gradient-to-br from-violet-600 to-purple-600 rounded-lg p-6 text-white shadow-md">
          <h3 className="text-sm font-medium opacity-90 mb-2">
            {t("stats:airportStats.farthestFromHome")}
          </h3>
          {farthestFromHome ? (
            <>
              <p className="text-3xl font-bold mb-1">{farthestFromHome.code}</p>
              <p className="text-sm opacity-75">
                {t("stats:airportStats.farthestFromHomeDesc", {
                  distance: farthestFromHome.distanceKm.toLocaleString(),
                  home: farthestFromHome.homeCode,
                })}
              </p>
              {farthestFromHome.name && (
                <p className="text-xs opacity-60 mt-1">{farthestFromHome.name}</p>
              )}
            </>
          ) : (
            <p className="text-sm opacity-75">{t("stats:airportStats.farthestFromHomeNoHome")}</p>
          )}
        </div>

        {/* New this year */}
        <div
          className="rounded-lg p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3
            className="text-sm font-semibold mb-3 uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            {t("stats:airportStats.newThisYear", { year: new Date().getFullYear() })}
          </h3>
          {newThisYear.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("stats:airportStats.newThisYearEmpty")}
            </p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {newThisYear.map((a) => (
                <li
                  key={a.code}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: "var(--text-primary)" }}
                >
                  <span className="font-semibold">{a.code}</span>
                  <span className="truncate" style={{ color: "var(--text-muted)" }}>
                    {a.name || a.country || "—"}
                  </span>
                  <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                    {a.firstVisitDate}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Rarest airports */}
        <div
          className="rounded-lg p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3
            className="text-sm font-semibold mb-3 uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            {t("stats:airportStats.rarestAirports")}
          </h3>
          {rarestAirports.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("stats:airportStats.rarestAirportsEmpty")}
            </p>
          ) : (
            <ul className="space-y-1">
              {rarestAirports.map((a) => (
                <li
                  key={a.code}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: "var(--text-primary)" }}
                >
                  <span className="font-semibold">{a.code}</span>
                  <span className="truncate" style={{ color: "var(--text-muted)" }}>
                    {a.name || a.country || "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Continent distribution */}
        <div
          className="rounded-lg p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3
            className="text-sm font-semibold mb-3 uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            {t("stats:airportStats.continentDistribution")}
          </h3>
          {sortedContinents.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("stats:airportStats.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {sortedContinents.map(([cont, count]) => {
                const percent = continentTotal > 0 ? Math.round((count / continentTotal) * 100) : 0;
                return (
                  <li key={cont}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span style={{ color: "var(--text-primary)" }}>
                        {t(CONTINENT_LABEL_KEY[cont] || "stats:airportStats.continent.other")}
                      </span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {count} ({percent}%)
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--accent)]"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
