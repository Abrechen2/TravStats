import { useEffect, useState } from "react";
import { statsApi, type CruiseStatsResponse } from "../../lib/api/stats";
import { cruiseApi } from "../../lib/api/cruise";
import { deriveCruiseStats } from "../../lib/stats/cruiseStatsDetail";
import { useDomainColors } from "../../hooks/useDomainColors";
import {
  CruiseRhythmSection,
  CruiseMoneySection,
  CruiseFunSection,
} from "./cruise/CruiseDetailSections";
import type { Cruise } from "../../types/cruise";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { convertDistance, getDistanceLabel } from "../../lib/units";
import { useSettingsStore } from "../../store/settingsStore";
import { cruisesStartedIn } from "../../lib/stats/periodScope";
import PeriodComparisonStrip from "./PeriodComparisonStrip";
import { dimWhile, sameScope, type PeriodScope } from "./useStatsPeriod";
import type { SectionVisibility } from "../../hooks/useSectionVisibility";

type TFunction = (key: string, options?: Record<string, unknown>) => string;

/**
 * Cruise-domain stats section shown under the StatsPage cruise tab.
 * Fetches `/api/v1/stats/cruise` (which runs `calculateCruiseStats` on the
 * backend) and lays out the response per the Codex audit:
 *
 *   1. Hero KPI grid — 8 lifetime metrics
 *   2. Region distribution + sea/port mix charts
 *   3. Depth + loyalty row
 *   4. Discovery tag clouds (lines, regions, countries)
 *   5. Achievement-style boolean flag pills
 *
 * Scoped to the page's period twice over, and both ways say the same thing: the
 * rollup by the server (`?year=`), the rows behind the rhythm, money and fun
 * blocks by `cruisesStartedIn` — the year a cruise sailed from.
 */
export default function CruiseStatsSection({
  scope,
  visibility,
}: {
  scope: PeriodScope;
  visibility: SectionVisibility;
}): JSX.Element {
  const { t, i18n } = useTranslation(["stats", "cruise", "common"]);
  const distanceUnit = useSettingsStore((state) => state.units.distanceUnit);
  const distanceLabel = getDistanceLabel(distanceUnit, t);
  const { year, compareYear } = scope;
  const [stats, setStats] = useState<CruiseStatsResponse | null>(null);
  const [previous, setPrevious] = useState<CruiseStatsResponse | null>(null);
  const [loadedFor, setLoadedFor] = useState<PeriodScope | null>(null);
  // The rollup answers the collection questions and carries no calendar, no
  // money and no firsts — those live on the rows.
  const [cruises, setCruises] = useState<Cruise[]>([]);
  const { colorOf } = useDomainColors();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Earlier figures stay on screen while the next year loads.
        const [data, before, rows] = await Promise.all([
          statsApi.getCruiseStats(year === null ? undefined : { year }),
          compareYear === null
            ? Promise.resolve(null)
            : statsApi.getCruiseStats({ year: compareYear }),
          cruiseApi.list(),
        ]);
        if (cancelled) return;
        setStats(data);
        setPrevious(before);
        setCruises(rows);
        setLoadedFor({ year, compareYear });
        setError(null);
      } catch (err) {
        logger.error("Failed to load cruise stats:", err);
        if (!cancelled) setError(t("stats:cruiseSection.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, year, compareYear]);

  if (loading) {
    return (
      <div
        className="rounded-lg p-6"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("common:loading.default")}
        </p>
      </div>
    );
  }

  if (error !== null || !stats) {
    return (
      <div
        className="rounded-lg p-6"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--danger)",
          color: "var(--danger)",
        }}
      >
        <p className="text-sm">{error ?? t("stats:cruiseSection.loadError")}</p>
      </div>
    );
  }

  // What is on screen was loaded for `shown`, which lags `scope` while the next
  // year is on its way. Every label below reads `shown`; see `sameScope`.
  const shown = loadedFor ?? scope;
  const refreshing = !sameScope(loadedFor, scope);

  const comparison =
    previous && shown.year !== null && shown.compareYear !== null ? (
      <PeriodComparisonStrip
        year={shown.year}
        compareYear={shown.compareYear}
        rows={[
          {
            key: "cruises",
            label: t("stats:cruiseSection.count"),
            current: stats.cruisesCount,
            previous: previous.cruisesCount,
          },
          {
            key: "seaDays",
            label: t("stats:cruiseSection.seaDays"),
            current: stats.seaDays,
            previous: previous.seaDays,
          },
          {
            key: "ports",
            label: t("stats:cruiseSection.ports"),
            current: stats.cruisePortsUnique,
            previous: previous.cruisePortsUnique,
          },
          {
            key: "distance",
            label: t("stats:cruiseSection.totalDistance"),
            current: convertDistance(stats.totalDistanceKm, distanceUnit),
            previous: convertDistance(previous.totalDistanceKm, distanceUnit),
            format: (n) => `${formatNumber(n)} ${distanceLabel}`,
          },
        ]}
      />
    ) : null;

  // A year with no cruise names the year. The lifetime empty state invites the
  // first cruise, which is the wrong thing to say to someone with twenty.
  if (stats.cruisesCount === 0 && shown.year !== null) {
    return (
      <div className="space-y-6" aria-busy={refreshing} style={dimWhile(refreshing)}>
        {comparison}
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("stats:period.emptyYear", { year: shown.year })}
        </p>
      </div>
    );
  }

  if (stats.cruisesCount === 0) {
    return (
      <div
        className="rounded-lg px-6 py-10 text-center"
        style={{
          background: "var(--bg-surface)",
          border: "1px dashed var(--color-border)",
          color: "var(--text-muted)",
        }}
      >
        <p className="mb-2 text-3xl" aria-hidden>
          🚢
        </p>
        <p className="font-medium text-(--text-primary)">{t("stats:cruiseSection.emptyTitle")}</p>
        <p className="mt-1 text-sm">{t("stats:cruiseSection.emptyHint")}</p>
      </div>
    );
  }

  const avgPortsPerCruise = stats.cruisesCount > 0 ? stats.totalPortCalls / stats.cruisesCount : 0;
  // `seaDays` counts stop rows across every cruise; `totalCruiseDays` counts
  // calendar days and is 0 for a cruise with no dates. A cruise recorded
  // without dates but with sea days therefore fed the numerator and not the
  // denominator, and the donut drew past a full circle. Capped, because a
  // share of the days sailed cannot exceed those days.
  const seaDayRatioPct =
    stats.totalCruiseDays > 0
      ? Math.min(100, Math.round((stats.seaDays / stats.totalCruiseDays) * 100))
      : 0;
  // Revisits are measured over the calls that CAN be identified. An imported
  // port name nothing matched is a real call — it counts in `totalPortCalls` —
  // but it has no catalogue id, so it can never appear in `cruisePortsUnique`.
  // Dividing by the total therefore counted every unresolved call as a
  // revisit: five calls, three of them unresolved, read as "60 % revisited"
  // for someone who never returned anywhere.
  const identifiableCalls = stats.resolvedPortCalls ?? stats.totalPortCalls;
  const revisitRatePct =
    identifiableCalls > 0
      ? Math.round(((identifiableCalls - stats.cruisePortsUnique) / identifiableCalls) * 100)
      : 0;

  const heroKpis: Array<{ label: string; value: string | number }> = [
    { label: t("stats:cruiseSection.count"), value: stats.cruisesCount },
    {
      label: t("stats:cruiseSection.totalDistance"),
      // Was a hardcoded "km". The flight sections have always honoured
      // Einheiten & Formate, so a user on miles got miles for flights and
      // kilometres for cruises on the same page.
      value: `${formatNumber(convertDistance(stats.totalDistanceKm, distanceUnit))} ${distanceLabel}`,
    },
    { label: t("stats:cruiseSection.seaDays"), value: stats.seaDays },
    { label: t("stats:cruiseSection.ports"), value: stats.cruisePortsUnique },
    { label: t("stats:cruiseSection.ships"), value: stats.cruiseShipsUnique },
    { label: t("stats:cruiseSection.lines"), value: stats.cruiseLinesUnique },
    { label: t("stats:cruiseSection.avgPortsPerCruise"), value: avgPortsPerCruise.toFixed(1) },
    {
      label: t("stats:cruiseSection.longestLeg"),
      value:
        stats.longestLegKm > 0
          ? `${formatNumber(convertDistance(stats.longestLegKm, distanceUnit))} ${distanceLabel}`
          : "—",
    },
  ];

  const depthKpis: Array<{ label: string; value: string | number }> = [
    { label: t("stats:cruiseSection.maxPortsSingle"), value: stats.cruisePortsSingleMax },
    { label: t("stats:cruiseSection.lineLoyaltyMax"), value: stats.cruiseLineLoyaltyMax },
    { label: t("stats:cruiseSection.seaDaysStreak"), value: stats.seaDaysStreak },
    { label: t("stats:cruiseSection.maxDeck"), value: stats.maxDeck > 0 ? stats.maxDeck : "—" },
    { label: t("stats:cruiseSection.totalDays"), value: stats.totalCruiseDays },
    { label: t("stats:cruiseSection.revisitRate"), value: `${revisitRatePct}%` },
    // Count the ISO-folded set, not the raw names: the port catalogue carries
    // both "United States" and "United States of America", so counting names
    // reported one country too many — and disagreed with the cross-domain tile
    // on the Gesamt page, which folds. The tag cloud below still shows names.
    {
      label: t("stats:cruiseSection.countries"),
      value: (stats.countriesIso ?? stats.countries).length,
    },
  ];

  const detail = deriveCruiseStats(
    shown.year === null ? cruises : cruisesStartedIn(cruises, shown.year)
  );
  const accent = colorOf("cruise");
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const show = visibility.isVisible;

  return (
    <div className="space-y-6" aria-busy={refreshing} style={dimWhile(refreshing)}>
      {comparison}

      {/* 1) Hero KPI grid */}
      {show("kpis") && <KpiGrid kpis={heroKpis} />}

      {/* 2) Region bar chart + sea/port donut */}
      {show("regions") && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <RegionBars
              regionVisitCounts={stats.regionVisitCounts}
              title={t("stats:cruiseSection.regionsHeading")}
              emptyHint={t("stats:cruiseSection.noRegions")}
              t={t}
            />
          </div>
          <SeaDayDonut
            seaDays={stats.seaDays}
            totalDays={stats.totalCruiseDays}
            pct={seaDayRatioPct}
            label={t("stats:cruiseSection.seaDayShare")}
          />
        </div>
      )}

      {/* 3) Depth & loyalty */}
      {show("depth") && <KpiGrid kpis={depthKpis} compact />}

      {/* 4) Tag clouds */}
      {show("tags") && stats.cruiseLines.length > 0 && (
        <TagCloud title={t("stats:cruiseSection.linesLabel")} items={stats.cruiseLines} />
      )}
      {show("tags") && stats.regions.length > 0 && (
        <TagCloud
          title={t("stats:cruiseSection.regionsLabel")}
          items={stats.regions.map((r) => prettyRegion(r, t))}
        />
      )}
      {show("tags") && stats.countries.length > 0 && (
        <TagCloud title={t("stats:cruiseSection.countriesLabel")} items={stats.countries} />
      )}

      {/* 5) Achievement-style flag strip */}
      {show("flags") && (
        <div className="flex flex-wrap gap-2 text-xs">
          {stats.hasBalconyCabin && (
            <Flag label={t("stats:cruiseSection.flags.balcony")} emoji="🏝️" />
          )}
          {stats.hasSuiteCabin && <Flag label={t("stats:cruiseSection.flags.suite")} emoji="👑" />}
          {stats.hasPolar && <Flag label={t("stats:cruiseSection.flags.polar")} emoji="🧊" />}
          {stats.hasColdWater && (
            <Flag label={t("stats:cruiseSection.flags.coldWater")} emoji="❄️" />
          )}
          {stats.hasCanalTransit && (
            <Flag label={t("stats:cruiseSection.flags.canal")} emoji="⛴️" />
          )}
          {stats.hasDatelineCrossing && (
            <Flag label={t("stats:cruiseSection.flags.dateline")} emoji="🌐" />
          )}
          {stats.hasBirthdayAtSea && (
            <Flag label={t("stats:cruiseSection.flags.birthday")} emoji="🎂" />
          )}
          {stats.hasNewYearsAtSea && (
            <Flag label={t("stats:cruiseSection.flags.newYears")} emoji="🎇" />
          )}
        </div>
      )}

      {show("rhythm") && <CruiseRhythmSection detail={detail} accent={accent} locale={locale} />}
      {show("money") && <CruiseMoneySection detail={detail} accent={accent} locale={locale} />}
      {show("fun") && <CruiseFunSection detail={detail} accent={accent} locale={locale} />}
    </div>
  );
}

function KpiGrid({
  kpis,
  compact = false,
}: {
  kpis: Array<{ label: string; value: string | number }>;
  compact?: boolean;
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="rounded-lg shadow-sm p-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3 className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            {kpi.label}
          </h3>
          <p
            className={`${compact ? "text-xl" : "text-2xl"} font-bold mt-1 font-mono`}
            style={{ color: "var(--text-primary)" }}
          >
            {kpi.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function RegionBars({
  regionVisitCounts,
  title,
  emptyHint,
  t,
}: {
  regionVisitCounts: Record<string, number>;
  title: string;
  emptyHint: string;
  t: TFunction;
}): JSX.Element {
  const sorted = Object.entries(regionVisitCounts).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] ?? 0;

  return (
    <div
      className="rounded-lg p-4 h-full"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      {sorted.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {emptyHint}
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.slice(0, 8).map(([region, count]) => (
            <li key={region} className="flex items-center gap-3 text-xs">
              <span
                className="w-32 shrink-0 truncate"
                style={{ color: "var(--text-primary)" }}
                title={prettyRegion(region, t)}
              >
                {prettyRegion(region, t)}
              </span>
              <div
                className="flex-1 h-3 rounded-full overflow-hidden"
                style={{ background: "var(--bg-elevated)" }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${max > 0 ? (count / max) * 100 : 0}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
              <span className="w-8 text-right font-mono" style={{ color: "var(--text-primary)" }}>
                {count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeaDayDonut({
  seaDays,
  totalDays,
  pct,
  label,
}: {
  seaDays: number;
  totalDays: number;
  pct: number;
  label: string;
}): JSX.Element {
  // Conic-gradient donut — no chart lib needed. Inner label shows the
  // percentage; subtitle explains the ratio.
  const trackColor = "var(--bg-elevated)";
  const fillColor = "var(--accent)";
  const gradient = `conic-gradient(${fillColor} 0deg ${pct * 3.6}deg, ${trackColor} ${pct * 3.6}deg 360deg)`;

  return (
    <div
      className="rounded-lg p-4 h-full flex flex-col items-center justify-center"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="text-sm font-medium mb-3 self-start" style={{ color: "var(--text-muted)" }}>
        {label}
      </h3>
      <div
        className="relative w-32 h-32 rounded-full"
        style={{ background: gradient }}
        aria-label={`${pct}%`}
      >
        <div
          className="absolute inset-3 rounded-full flex items-center justify-center"
          style={{ background: "var(--bg-surface)" }}
        >
          <span className="text-2xl font-bold font-mono" style={{ color: "var(--text-primary)" }}>
            {pct}%
          </span>
        </div>
      </div>
      <p className="mt-3 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
        {seaDays} / {totalDays} d
      </p>
    </div>
  );
}

function TagCloud({ title, items }: { title: string; items: string[] }): JSX.Element {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="text-sm font-medium mb-2" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">
        {items.map((label) => (
          <span
            key={label}
            className="px-2 py-0.5 rounded-full text-xs"
            style={{
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              border: "1px solid var(--color-border)",
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Flag({ label, emoji }: { label: string; emoji: string }): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md"
      style={{
        background: "var(--bg-elevated)",
        color: "var(--text-primary)",
        border: "1px solid var(--color-border)",
      }}
    >
      <span aria-hidden>{emoji}</span>
      {label}
    </span>
  );
}

/**
 * Region slug -> display label, via i18n.
 *
 * This used to read from a hardcoded German map of TEN slugs while the port
 * catalogue uses FIFTY-FOUR. Everything unmapped fell through to the
 * title-case fallback, so a German UI showed "Mittelmeer" and "Ostsee" next to
 * "North Sea", "Aegean" and "Iberian Atlantic" — which read like mixed data but
 * was simply an incomplete map. The German labels were also hardcoded, so an
 * English UI got German names for the ten that WERE mapped.
 *
 * The fallback stays: a slug the catalogue gains before the translations do
 * renders readably instead of blank.
 */
function prettyRegion(slug: string, t: TFunction): string {
  const translated = t(`stats:cruiseSection.regions.${slug}`);
  // i18next echoes the key back when it has no entry.
  if (translated && !translated.endsWith(`.${slug}`)) return translated;
  return slug
    .split(/[_\s]+/)
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("de-DE").format(Math.round(n));
}
