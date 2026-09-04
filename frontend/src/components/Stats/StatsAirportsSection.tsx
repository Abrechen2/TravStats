import type { AirportStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { continentI18nKey } from "../../lib/continentLabel";
import StatCard from "./StatCard";

interface StatsAirportsSectionProps {
  airportStats: AirportStats | null;
}

/**
 * The server names continents in its own vocabulary ("North America",
 * "Antarctica"); the client only labels them, through the same keys the
 * places domain uses. "Other" is the absence of a continent and keeps its
 * own word.
 */
function continentKey(continent: string): string {
  return continent === "Other"
    ? "stats:airportStats.continent.other"
    : continentI18nKey(continent);
}

export default function StatsAirportsSection({
  airportStats,
}: StatsAirportsSectionProps): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);

  if (!airportStats) {
    return (
      <div className="mt-8">
        <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
          {t("stats:airportStats.title")}
        </h2>
        <div
          className="rounded-lg shadow-sm p-6 text-center"
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
    continentTotal,
    topAirports,
    rarestAirports,
    newThisYear,
    farthestFromHome,
    topCountries,
    continentDistribution,
  } = airportStats;

  const distributionTotal = Object.values(continentDistribution).reduce((s, v) => s + v, 0);
  const sortedContinents = Object.entries(continentDistribution).sort(([, a], [, b]) => b - a);

  return (
    <div className="mt-8">
      <h2 className="text-3xl font-bold mb-6" style={{ color: "var(--text-primary)" }}>
        {t("stats:airportStats.title")}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <StatCard
          title={t("stats:airportStats.airportCount")}
          value={airportCount}
          description={t("stats:airportStats.airportCountDesc")}
        />
        <StatCard
          title={t("stats:airportStats.countryCount")}
          value={countryCount}
          description={t("stats:airportStats.countryCountDesc")}
        />
        <StatCard
          title={t("stats:airportStats.continentCount")}
          value={
            <>
              {continentCount}
              {/* The denominator is the server's, and it sits tight against the slash:
                  "6/ 6" with a hard-coded six was the whole of forgejo#87. */}
              <span className="text-xl opacity-70">/{continentTotal}</span>
            </>
          }
          description={t("stats:airportStats.continentCountDesc", { total: continentTotal })}
        />
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

        {farthestFromHome ? (
          <StatCard
            title={t("stats:airportStats.farthestFromHome")}
            valueSize="md"
            value={farthestFromHome.code}
            description={t("stats:airportStats.farthestFromHomeDesc", {
              distance: farthestFromHome.distanceKm.toLocaleString(),
              home: farthestFromHome.homeCode,
            })}
            footnote={farthestFromHome.name || undefined}
          />
        ) : (
          <div
            className="rounded-lg p-6"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <h3
              className="text-sm font-semibold mb-3 uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              {t("stats:airportStats.farthestFromHome")}
            </h3>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("stats:airportStats.farthestFromHomeNoHome")}
            </p>
          </div>
        )}

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
                const percent =
                  distributionTotal > 0 ? Math.round((count / distributionTotal) * 100) : 0;
                return (
                  <li key={cont}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span style={{ color: "var(--text-primary)" }}>
                        {t(continentKey(cont))}
                      </span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {count} ({percent}%)
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-(--bg-elevated) overflow-hidden">
                      <div
                        className="h-full rounded-full bg-(--accent)"
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
