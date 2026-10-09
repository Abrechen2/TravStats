import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import { statsInsightsApi } from "../../../lib/api/statsInsights";
import type { TourInsights } from "../../../types/statsInsights";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import EvidenceNumber from "../EvidenceNumber";
import InsightTile from "../insight/InsightTile";
import { helpText, totalFor } from "../insight/insightFold";

/**
 * Day tours and planned guided excursions (forgejo#264): what each activity
 * added up to, moving time apart from pauses, personal records, the rhythm of
 * the year with first-time and repeated areas, and what a tour hangs on.
 *
 * Lives on the roadtrip tab because tours share its beta switch and its
 * engine; it loads on its own, so a user with tours and no roadtrip still
 * sees it. Every figure is the server's (`GET /stats/insights/tours`): a tour
 * counts once recorded or dated before today, and climb, moving time and
 * height come only from recordings.
 */
export default function TourStatsSection({
  year,
  accent,
}: {
  year: number | null;
  accent: string;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["roadtrips", "stats", "common"]);
  const [data, setData] = useState<TourInsights | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    statsInsightsApi
      .tours()
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => {
        logger.warn("TourStatsSection: fetch failed", err);
        if (!cancelled) setFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }),
    [i18n.language]
  );
  const regions = useMemo(
    () =>
      typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames([i18n.language], { type: "region" })
        : null,
    [i18n.language]
  );

  if (failed) {
    return <p className="text-sm text-(--text-muted)">{t("roadtrips:stats.tours.loadFailed")}</p>;
  }
  if (!data) return null;

  const scope: EvidenceScopeParams =
    year === null ? { period: "allTime" } : { period: "year", year };
  const help = (block: string, values: Record<string, unknown> = {}) =>
    helpText(t, `roadtrips:stats.tours.${block}`, values);
  const activity = (key: string): string =>
    key === "unknown"
      ? t("roadtrips:stats.tours.noActivity")
      : t(`roadtrips:activity.${key}`, { defaultValue: key });
  const hours = (seconds: number): string => nf.format(Math.round(seconds / 360) / 10);
  const country = (code: string): string => regions?.of(code) ?? code;

  const count = totalFor(data.totals, "tourCompletedCount", year);
  const km = totalFor(data.totals, "tourDistanceKm", year);
  const ascent = totalFor(data.totals, "tourAscentM", year);
  const moving = totalFor(data.totals, "tourMovingMinutes", year);
  const lifetime = t("roadtrips:stats.tours.lifetime");

  return (
    <section className="flex flex-col gap-4" data-testid="tour-stats">
      <h2 className="text-lg font-semibold">{t("roadtrips:stats.tours.title")}</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InsightTile
          testId="tour-activities"
          title={t("roadtrips:stats.tours.activities.title")}
          accent={accent}
          value={count > 0 ? nf.format(count) : null}
          evidence={{ key: "tourCompletedCount", scope, renderedValue: count }}
          empty={t("roadtrips:stats.tours.activities.empty")}
          description={
            count > 0 ? (
              <>
                <EvidenceNumber
                  evidenceKey="tourDistanceKm"
                  scope={scope}
                  renderedValue={km}
                  label={t("roadtrips:stats.tours.activities.km")}
                >
                  {`${nf.format(km)} km`}
                </EvidenceNumber>
                {" · "}
                <EvidenceNumber
                  evidenceKey="tourAscentM"
                  scope={scope}
                  renderedValue={ascent}
                  label={t("roadtrips:stats.tours.activities.ascent")}
                >
                  {t("roadtrips:stats.tours.activities.ascentValue", { m: nf.format(ascent) })}
                </EvidenceNumber>
              </>
            ) : undefined
          }
          help={help("activities", {
            planned: data.planned,
            undated: data.undated,
            partial: data.partial,
          })}
        >
          {data.byActivity.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs" data-testid="tour-activities-rows">
              {data.byActivity.map((a) => (
                <li key={a.activity}>
                  <span className="font-medium">{activity(a.activity)}</span>{" "}
                  {t("roadtrips:stats.tours.activities.row", {
                    count: a.completed,
                    km: nf.format(a.km.total),
                    kmTours: a.km.tours,
                    ascent: nf.format(a.ascentM.total),
                    ascentTours: a.ascentM.tours,
                    hours: hours(a.movingSeconds.total),
                    movingTours: a.movingSeconds.tours,
                  })}
                </li>
              ))}
              <li className="opacity-75">{lifetime}</li>
            </ul>
          )}
        </InsightTile>

        <InsightTile
          testId="tour-moving"
          title={t("roadtrips:stats.tours.moving.title")}
          accent={accent}
          value={
            data.all.movingSeconds.tours > 0 ? (
              <EvidenceNumber
                evidenceKey="tourMovingMinutes"
                scope={scope}
                renderedValue={moving}
                label={t("roadtrips:stats.tours.moving.moving")}
              >
                {t("roadtrips:stats.tours.moving.hours", { h: hours(moving * 60) })}
              </EvidenceNumber>
            ) : null
          }
          empty={t("roadtrips:stats.tours.moving.empty")}
          description={
            data.all.pauseSeconds.tours > 0
              ? t("roadtrips:stats.tours.moving.pause", {
                  h: hours(data.all.pauseSeconds.total),
                  count: data.all.pauseSeconds.tours,
                  of: data.all.completed,
                })
              : undefined
          }
          help={help("moving")}
        />

        <InsightTile
          testId="tour-records"
          title={t("roadtrips:stats.tours.records.title")}
          accent={accent}
          value={
            data.records.some((r) => r.longest)
              ? t("roadtrips:stats.tours.records.value", { count: data.records.length })
              : null
          }
          empty={t("roadtrips:stats.tours.records.empty")}
          description={lifetime}
          help={help("records")}
          entries={data.records.flatMap((r) =>
            [
              r.longest && {
                key: `${r.activity}-longest`,
                href: `/tours/${r.longest.tourId}`,
                label: r.longest.name,
                detail: t("roadtrips:stats.tours.records.longest", {
                  activity: activity(r.activity),
                  km: nf.format(r.longest.value),
                  source: t(`roadtrips:stats.tours.records.source.${r.longest.source ?? "route"}`),
                }),
              },
              r.mostAscent && {
                key: `${r.activity}-ascent`,
                href: `/tours/${r.mostAscent.tourId}`,
                label: r.mostAscent.name,
                detail: t("roadtrips:stats.tours.records.ascent", {
                  activity: activity(r.activity),
                  m: nf.format(r.mostAscent.value),
                }),
              },
              r.highest && {
                key: `${r.activity}-highest`,
                href: `/tours/${r.highest.tourId}`,
                label: r.highest.name,
                detail: t("roadtrips:stats.tours.records.highest", {
                  activity: activity(r.activity),
                  m: nf.format(r.highest.value),
                }),
              },
            ].filter((e): e is NonNullable<typeof e> => Boolean(e))
          )}
        />

        <InsightTile
          testId="tour-rhythm"
          title={t("roadtrips:stats.tours.rhythm.title")}
          accent={accent}
          value={
            data.rhythm.byYear.length > 0
              ? t("roadtrips:stats.tours.rhythm.value", { count: data.rhythm.firstAreas.length })
              : null
          }
          empty={t("roadtrips:stats.tours.rhythm.empty")}
          description={data.rhythm.byYear.map((y) => `${y.year}: ${y.tours}`).join(" · ")}
          help={help("rhythm", { withoutArea: data.rhythm.withoutArea })}
          entries={data.rhythm.firstAreas.map((a) => ({
            key: a.country,
            href: `/tours/${a.tourId}`,
            label: country(a.country),
            detail: [a.name, a.day].filter(Boolean).join(" · "),
          }))}
        >
          {data.rhythm.byYear.length > 0 && (
            <ol className="mt-2 grid grid-cols-6 gap-1 text-center text-xs sm:grid-cols-12">
              {data.rhythm.byMonth.map((n, i) => (
                <li
                  key={i}
                  className="rounded px-1 py-1"
                  aria-label={`${t(`roadtrips:stats.tours.rhythm.month.${i}`)}: ${n}`}
                  style={{ border: "1px solid var(--color-border)" }}
                >
                  <span className="block opacity-75">
                    {t(`roadtrips:stats.tours.rhythm.month.${i}`).slice(0, 3)}
                  </span>
                  <span style={{ color: accent }}>{n}</span>
                </li>
              ))}
            </ol>
          )}
          {data.rhythm.repeatedAreas.length > 0 && (
            <p className="mt-2 text-xs opacity-75">
              {t("roadtrips:stats.tours.rhythm.repeated", {
                areas: data.rhythm.repeatedAreas
                  .map((a) => `${country(a.country)} (${a.tours})`)
                  .join(", "),
              })}
            </p>
          )}
        </InsightTile>

        <InsightTile
          testId="tour-links"
          title={t("roadtrips:stats.tours.links.title")}
          accent={accent}
          value={
            data.all.completed > 0
              ? t("roadtrips:stats.tours.links.value", {
                  trip: data.links.onTrip,
                  roadtrip: data.links.fromRoadtrip,
                  cruise: data.links.duringCruise,
                })
              : null
          }
          empty={t("roadtrips:stats.tours.links.empty")}
          description={t("roadtrips:stats.tours.links.description", {
            standalone: data.links.standalone,
          })}
          help={help("links")}
        >
          {(data.links.excursions.completed > 0 || data.links.excursions.planned > 0) && (
            <p className="mt-2 text-sm" data-testid="tour-links-excursions">
              {t("roadtrips:stats.tours.links.excursions", {
                count: data.links.excursions.completed,
                km: nf.format(data.links.excursions.km),
                planned: data.links.excursions.planned,
              })}
            </p>
          )}
        </InsightTile>
      </div>
    </section>
  );
}
