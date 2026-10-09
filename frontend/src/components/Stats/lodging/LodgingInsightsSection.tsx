import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { logger } from "../../../lib/logger";
import { formatCurrency, type Currency } from "../../../lib/units";
import { statsInsightsApi } from "../../../lib/api/statsInsights";
import type { LodgingInsights } from "../../../types/statsInsights";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import EvidenceNumber from "../EvidenceNumber";
import InsightTile from "../insight/InsightTile";
import RankedBarList, { type RankedRow } from "./RankedBarList";
import { foldSleepStyle, helpText, median, totalFor } from "../insight/insightFold";

const SEASONS = ["spring", "summer", "autumn", "winter"] as const;

/**
 * The lodging insights (forgejo#258): how you sleep, where you come back to,
 * how often you move on a trip, what the same room costs over the years, and
 * when in the week and year your nights fall.
 *
 * Every number is the server's (`GET /stats/insights/lodging`), computed by the
 * same counting rule as the rest of this tab — a stay counts once its check-out
 * is past. The answer is lifetime with per-year series; this component only
 * picks the slice for the period strip, and says "über alle Jahre" where a
 * figure has no year (coming back to a house cannot happen inside one).
 */
export default function LodgingInsightsSection({
  year,
}: {
  year: number | null;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["lodging", "stats", "common"]);
  const accent = useDomainColors().colorOf("lodging");
  const [data, setData] = useState<LodgingInsights | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    statsInsightsApi
      .lodging()
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => {
        logger.error("LodgingInsightsSection: fetch failed", err);
        if (!cancelled) setFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const nf = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const sleep = useMemo(() => (data ? foldSleepStyle(data, year) : null), [data, year]);

  if (failed) {
    return <p className="text-sm text-(--text-muted)">{t("lodging:stats.insights.loadFailed")}</p>;
  }
  if (!data || !sleep) return null;

  const scope: EvidenceScopeParams =
    year === null ? { period: "allTime" } : { period: "year", year };
  const lifetime = t("lodging:stats.insights.lifetime");
  const help = (block: string, values: Record<string, unknown> = {}) =>
    helpText(t, `lodging:stats.insights.${block}`, values);

  // ── Sleeping style ────────────────────────────────────────────────────
  const sleepRows: RankedRow[] = sleep.rows.map(([type, nights]) => ({
    key: type,
    label: t(`lodging:type.${type}`, { defaultValue: type }),
    weight: nights,
    value: `${Math.round((nights / sleep.total) * 100)} %`,
    hint: t("lodging:stats.insights.nights", { count: nights }),
  }));
  const yearsLine = data.sleepStyle.byYear
    .map((y) => {
      const [top] = Object.entries(y.nightsByType).sort(([, a], [, b]) => b - a);
      return top
        ? `${y.year}: ${t(`lodging:type.${top[0]}`, { defaultValue: top[0] })} ${Math.round((top[1] / y.nights) * 100)} %`
        : null;
    })
    .filter((s): s is string => s !== null);

  // ── Week rhythm ───────────────────────────────────────────────────────
  const weekend = totalFor(data.totals, "lodgingWeekendNights", year);
  const weekday = totalFor(data.totals, "lodgingWeekdayNights", year);
  const business = totalFor(data.totals, "lodgingBusinessNights", year);
  const seasonSource =
    year === null ? data.weekRhythm.byYear : data.weekRhythm.byYear.filter((y) => y.year === year);
  const seasons = SEASONS.map((s) => ({
    season: s,
    nights: seasonSource.reduce((sum, y) => sum + (y.nightsBySeason[s] ?? 0), 0),
  }));

  // ── Trip bases ────────────────────────────────────────────────────────
  const trips = data.tripBases.trips.filter((b) => year === null || b.year === year);
  // A trip still under way has not made all its moves yet (review M7): the
  // median reads finished trips only; the list below names every trip.
  const finishedTrips = trips.filter((b) => b.completed);
  const changesMedian = median(finishedTrips.map((b) => b.changes));
  const longestBase = trips.reduce<(typeof trips)[number] | null>(
    (best, b) => (!best || b.longestBaseNights > best.longestBaseNights ? b : best),
    null
  );

  // ── Calendar ─────────────────────────────────────────────────────────
  const calendarYear =
    year !== null
      ? (data.calendar.byYear.find((y) => y.year === year) ?? null)
      : ([...data.calendar.byYear].sort((a, b) => b.months.length - a.months.length)[0] ?? null);

  const money = (value: number, currency: string): string =>
    formatCurrency(value, currency as Currency, { language: i18n.language });

  return (
    <section className="mt-2 flex flex-col gap-4" data-testid="lodging-insights">
      <h2 className="text-lg font-semibold">{t("lodging:stats.insights.title")}</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InsightTile
          testId="insight-sleep-style"
          title={t("lodging:stats.insights.sleepStyle.title")}
          accent={accent}
          value={
            sleep.total > 0 ? t("lodging:stats.insights.nights", { count: sleep.total }) : null
          }
          empty={t("lodging:stats.insights.sleepStyle.empty")}
          description={year === null ? lifetime : undefined}
          help={help("sleepStyle", {
            unknown: data.sleepStyle.unknownLengthStays,
            unplaced: data.sleepStyle.unplacedNights,
          })}
        >
          {sleep.total > 0 && (
            <RankedBarList
              title={t("lodging:stats.insights.sleepStyle.byType")}
              rows={sleepRows}
              accent={accent}
              emptyLabel={t("lodging:stats.insights.sleepStyle.empty")}
            />
          )}
          {year === null && yearsLine.length > 1 && (
            <p className="mt-2 text-xs opacity-75">{yearsLine.join(" · ")}</p>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-week"
          title={t("lodging:stats.insights.week.title")}
          accent={accent}
          value={
            weekend + weekday > 0 ? (
              <>
                <EvidenceNumber
                  evidenceKey="lodgingWeekendNights"
                  scope={scope}
                  renderedValue={weekend}
                  label={t("lodging:stats.insights.week.weekend")}
                >
                  {nf.format(weekend)}
                </EvidenceNumber>
                {" / "}
                <EvidenceNumber
                  evidenceKey="lodgingWeekdayNights"
                  scope={scope}
                  renderedValue={weekday}
                  label={t("lodging:stats.insights.week.weekday")}
                >
                  {nf.format(weekday)}
                </EvidenceNumber>
              </>
            ) : null
          }
          empty={t("lodging:stats.insights.week.empty")}
          description={t("lodging:stats.insights.week.description")}
          help={help("week", { notWalkable: data.weekRhythm.notWalkableNights })}
        >
          {weekend + weekday > 0 && (
            <p className="mt-2 text-xs opacity-75">
              {seasons
                .map(
                  (s) => `${t(`lodging:stats.rhythm.season.${s.season}`)} ${nf.format(s.nights)}`
                )
                .join(" · ")}
            </p>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-business"
          title={t("lodging:stats.insights.business.title")}
          accent={accent}
          value={business > 0 ? nf.format(business) : null}
          evidence={{ key: "lodgingBusinessNights", scope, renderedValue: business }}
          empty={t("lodging:stats.insights.business.empty")}
          description={t("lodging:stats.insights.business.description")}
          help={help("business", { unlabelled: data.weekRhythm.unlabelledNights })}
        />

        <InsightTile
          testId="insight-revisits"
          title={t("lodging:stats.insights.revisits.title")}
          accent={accent}
          value={
            data.revisits.houses.length > 0 ? (
              <EvidenceNumber
                evidenceKey="lodgingReturnHouseCount"
                scope={{ period: "allTime" }}
                renderedValue={data.revisits.houses.length}
                label={t("lodging:stats.insights.revisits.title")}
              >
                {nf.format(data.revisits.houses.length)}
              </EvidenceNumber>
            ) : null
          }
          empty={t("lodging:stats.insights.revisits.empty")}
          description={`${t("lodging:stats.insights.revisits.description")} · ${lifetime}`}
          help={help("revisits", { returned: data.revisits.returnedHouses })}
          entries={data.revisits.houses.slice(0, 10).map((h) => ({
            key: h.lodgingId,
            href: `/lodging/${h.lodgingId}`,
            label: h.name,
            detail: h.years.join(" · "),
          }))}
        >
          {data.revisits.longestGap && (
            <p className="mt-2 text-sm" data-testid="insight-revisits-gap">
              {t("lodging:stats.insights.revisits.longestGap", {
                days: nf.format(data.revisits.longestGap.days),
                from: data.revisits.longestGap.from,
                to: data.revisits.longestGap.to,
              })}{" "}
              <Link
                to={`/lodging/${data.revisits.longestGap.lodgingId}`}
                className="underline underline-offset-2"
              >
                {data.revisits.longestGap.name}
              </Link>
            </p>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-trip-bases"
          title={t("lodging:stats.insights.tripBases.title")}
          accent={accent}
          value={
            changesMedian === null
              ? null
              : t("lodging:stats.insights.tripBases.value", { count: changesMedian })
          }
          empty={t("lodging:stats.insights.tripBases.empty")}
          description={t("lodging:stats.insights.tripBases.description", {
            count: finishedTrips.length,
          })}
          help={help("tripBases", {
            withoutTrip: data.tripBases.staysWithoutTrip,
            undated: data.tripBases.undatedTripStays,
          })}
          entries={trips.slice(0, 12).map((b) => ({
            key: b.tripId,
            href: `/trips/${b.tripId}`,
            label: b.tripName,
            detail: [
              t("lodging:stats.insights.tripBases.houses", { count: b.houses }),
              t("lodging:stats.insights.tripBases.changes", { count: b.changes }),
              b.overlapNights > 0
                ? t("lodging:stats.insights.tripBases.overlap", { count: b.overlapNights })
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
        >
          {longestBase && longestBase.longestBaseNights > 0 && (
            <p className="mt-2 text-sm">
              {t("lodging:stats.insights.tripBases.longestBase", {
                count: longestBase.longestBaseNights,
                trip: longestBase.tripName,
              })}{" "}
              <Link
                to={`/lodging/${longestBase.longestBaseLodgingId}`}
                className="underline underline-offset-2"
              >
                {longestBase.longestBaseName}
              </Link>
            </p>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-prices"
          title={t("lodging:stats.insights.prices.title")}
          accent={accent}
          value={
            data.priceTrends.groups.length > 0
              ? t("lodging:stats.insights.prices.value", { count: data.priceTrends.groups.length })
              : null
          }
          empty={t("lodging:stats.insights.prices.empty")}
          description={lifetime}
          help={help("prices", {
            single: data.priceTrends.singlePricedStays,
            unpriced: data.priceTrends.unpricedStays,
            undated: data.priceTrends.undatedPricedStays,
            award: data.priceTrends.awardStays,
          })}
          entries={data.priceTrends.groups.slice(0, 10).map((g) => ({
            key: `${g.lodgingId}-${g.roomCategory}-${g.board}-${g.currency}`,
            href: `/lodging/${g.lodgingId}`,
            label: [
              g.name,
              g.roomCategory,
              g.board ? t(`lodging:board.${g.board}`, { defaultValue: g.board }) : null,
            ]
              .filter(Boolean)
              .join(" · "),
            detail:
              t("lodging:stats.insights.prices.row", {
                first: money(g.first.perNight, g.currency),
                firstDate: g.first.date,
                last: money(g.last.perNight, g.currency),
                lastDate: g.last.date,
                change: `${g.changePct > 0 ? "+" : ""}${nf.format(g.changePct)}`,
                count: g.stays,
              }) + (g.thin ? ` · ${t("lodging:stats.insights.prices.thin")}` : ""),
          }))}
        />

        <InsightTile
          testId="insight-calendar"
          title={t("lodging:stats.insights.calendar.title")}
          accent={accent}
          value={
            calendarYear
              ? t("lodging:stats.insights.calendar.value", { count: calendarYear.months.length })
              : null
          }
          empty={t("lodging:stats.insights.calendar.empty")}
          description={
            calendarYear && year === null
              ? t("lodging:stats.insights.calendar.bestYear", { year: calendarYear.year })
              : undefined
          }
          help={help("calendar")}
        >
          {calendarYear && (
            <ol className="mt-2 grid grid-cols-6 gap-1 text-center text-xs sm:grid-cols-12">
              {Array.from({ length: 12 }, (_, i) => {
                const filled = calendarYear.months.includes(i + 1);
                const name = t(`lodging:stats.rhythm.month.${i}`);
                return (
                  <li
                    key={i}
                    aria-label={`${name}: ${filled ? t("lodging:stats.insights.calendar.filled") : t("lodging:stats.insights.calendar.open")}`}
                    className="rounded px-1 py-1"
                    style={{
                      background: filled ? accent : "transparent",
                      color: filled ? "var(--bg-elevated)" : "var(--text-muted)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {name.slice(0, 3)}
                  </li>
                );
              })}
            </ol>
          )}
          {data.calendar.fullYears.length > 0 && (
            <p className="mt-2 text-xs opacity-75">
              {t("lodging:stats.insights.calendar.fullYears", {
                years: data.calendar.fullYears.join(", "),
              })}
            </p>
          )}
        </InsightTile>
      </div>
    </section>
  );
}
