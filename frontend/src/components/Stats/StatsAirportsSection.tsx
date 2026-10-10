import type { AirportStats } from "../../types";
import { formatNumber } from "../../lib/units";
import { useTranslation } from "../../hooks/useTranslation";
import { continentI18nKey } from "../../lib/continentLabel";
import StatCard from "./StatCard";
import CountingHelp from "./counting/CountingHelp";
import EvidenceTrigger from "./EvidenceTrigger";
import { rankingKey } from "../../shared/evidence";
import { todayZoneNow } from "../../hooks/useTodayZone";
import { todayIn } from "../../shared/time";
import { countryName } from "../../shared/geo/countryCode";

/** Every ranking dimension this section resolves is `allTime`-only — see `rankingEvidence.ts` on the backend. */
const ALL_TIME = { period: "allTime" as const };

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
  return continent === "Other" ? "stats:airportStats.continent.other" : continentI18nKey(continent);
}

export default function StatsAirportsSection({
  airportStats,
}: StatsAirportsSectionProps): JSX.Element {
  const { t, i18n } = useTranslation(["stats", "common"]);

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
  const currentYear = Number(todayIn(todayZoneNow()).slice(0, 4));

  /** "So wird gezählt" for every figure of the section (forgejo#256). */
  const help = [
    {
      term: t("stats:airportStats.airportCount"),
      helpKey: "flightStatsHelp:airports.airportCount",
    },
    {
      term: t("stats:airportStats.countryCount"),
      helpKey: "flightStatsHelp:airports.countryCount",
    },
    {
      term: t("stats:airportStats.continentCount"),
      helpKey: "flightStatsHelp:airports.continentCount",
    },
    { term: t("stats:airportStats.topAirports"), helpKey: "flightStatsHelp:airports.topAirports" },
    {
      term: t("stats:airportStats.topCountries"),
      helpKey: "flightStatsHelp:airports.topCountries",
    },
    {
      term: t("stats:airportStats.farthestFromHome"),
      helpKey: "flightStatsHelp:airports.farthestFromHome",
    },
    {
      term: t("stats:airportStats.newThisYear", { year: currentYear }),
      helpKey: "flightStatsHelp:airports.newThisYear",
    },
    { term: t("stats:airportStats.rarestAirports"), helpKey: "flightStatsHelp:airports.rarest" },
    {
      term: t("stats:airportStats.continentDistribution"),
      helpKey: "flightStatsHelp:airports.continentDistribution",
    },
  ];

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
          evidence={{
            kind: "metric",
            key: "airportsVisitedCount",
            scope: ALL_TIME,
            renderedValue: airportCount,
          }}
        />
        <StatCard
          title={t("stats:airportStats.countryCount")}
          value={countryCount}
          description={t("stats:airportStats.countryCountDesc")}
          evidence={{
            kind: "metric",
            key: "flightCountriesVisitedCount",
            scope: ALL_TIME,
            renderedValue: countryCount,
          }}
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
          evidence={{
            kind: "metric",
            key: "continentsVisitedCount",
            scope: ALL_TIME,
            renderedValue: continentCount,
          }}
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
                <li key={a.code}>
                  <EvidenceTrigger
                    kind="ranking"
                    evidenceKey={rankingKey("airport", a.code)}
                    scope={ALL_TIME}
                    renderedValue={a.visits}
                    label={`${a.code} ${a.name ?? ""}`.trim()}
                    className="flex items-center gap-3"
                  >
                    <span
                      className="text-sm font-bold w-6 text-right"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {i + 1}.
                    </span>
                    <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                      {a.code}
                    </span>
                    <span
                      className="text-sm flex-1 truncate"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {a.name || "—"}
                    </span>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {t("stats:airportStats.visits", { count: a.visits })}
                    </span>
                  </EvidenceTrigger>
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
              {topCountries.map((c, i) => {
                // The server sends an ISO 3166-1 alpha-2 code, never a name —
                // a country name belongs to the reader's language.
                const name = countryName(c.country, i18n.language) || c.country;
                return (
                  <li key={c.country}>
                    <EvidenceTrigger
                      kind="ranking"
                      evidenceKey={rankingKey("country", c.country)}
                      scope={ALL_TIME}
                      renderedValue={c.count}
                      label={name}
                      className="flex items-center gap-3"
                    >
                      <span
                        className="text-sm font-bold w-6 text-right"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {i + 1}.
                      </span>
                      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                        {name}
                      </span>
                      <span
                        className="text-sm ml-auto font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {t("stats:airportStats.flightsCount", { count: c.count })}
                      </span>
                    </EvidenceTrigger>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {farthestFromHome ? (
          <StatCard
            title={t("stats:airportStats.farthestFromHome")}
            valueSize="md"
            value={farthestFromHome.code}
            description={t("stats:airportStats.farthestFromHomeDesc", {
              distance: formatNumber(farthestFromHome.distanceKm, undefined, i18n.language),
              home: farthestFromHome.homeCode,
            })}
            footnote={farthestFromHome.name || undefined}
            evidence={{
              kind: "metric",
              key: "farthestFromHomeFlights",
              scope: ALL_TIME,
              renderedValue: null,
            }}
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
            {t("stats:airportStats.newThisYear", { year: currentYear })}
          </h3>
          {newThisYear.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("stats:airportStats.newThisYearEmpty")}
            </p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {newThisYear.map((a) => (
                <li key={a.code}>
                  <EvidenceTrigger
                    kind="ranking"
                    evidenceKey={rankingKey("airport", a.code)}
                    scope={ALL_TIME}
                    renderedValue={null}
                    label={`${a.code} ${a.name ?? ""}`.trim()}
                    className="flex items-center gap-2 text-sm"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <span className="font-semibold">{a.code}</span>
                    <span className="truncate" style={{ color: "var(--text-muted)" }}>
                      {a.name || countryName(a.country, i18n.language) || a.country || "—"}
                    </span>
                    <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                      {a.firstVisitDate}
                    </span>
                  </EvidenceTrigger>
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
                <li key={a.code}>
                  <EvidenceTrigger
                    kind="ranking"
                    evidenceKey={rankingKey("airport", a.code)}
                    scope={ALL_TIME}
                    renderedValue={null}
                    label={`${a.code} ${a.name ?? ""}`.trim()}
                    className="flex items-center gap-2 text-sm"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <span className="font-semibold">{a.code}</span>
                    <span className="truncate" style={{ color: "var(--text-muted)" }}>
                      {a.name || countryName(a.country, i18n.language) || a.country || "—"}
                    </span>
                  </EvidenceTrigger>
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
                      <span style={{ color: "var(--text-primary)" }}>{t(continentKey(cont))}</span>
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
      <CountingHelp entries={help} testId="airports-counting-help" />
    </div>
  );
}
