import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import { statsInsightsApi } from "../../../lib/api/statsInsights";
import type { PlaceInsights } from "../../../types/statsInsights";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import EvidenceNumber from "../EvidenceNumber";
import InsightTile from "../insight/InsightTile";
import { helpText, totalFor } from "../insight/insightFold";

/**
 * The places insights (forgejo#259): what was new and what was a return, how
 * long a return took, how varied a trip was, how well each visit is
 * documented, and the largest straight-line jump between two visits.
 *
 * Every figure comes from `GET /stats/insights/places`, counted by
 * `shared/placeCounting.ts` on the server — a wishlist place counts nowhere, a
 * visit dated in the future is a plan, an undated one counts for how many and
 * never for when. Lifetime with per-year series; this component picks the
 * slice for the period strip.
 */
export default function PoiInsightsSection({
  year,
  accent,
}: {
  year: number | null;
  accent: string;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["places", "stats", "common"]);
  const [data, setData] = useState<PlaceInsights | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    statsInsightsApi
      .places()
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => {
        logger.error("PoiInsightsSection: fetch failed", err);
        if (!cancelled) setFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const nf = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  if (failed) {
    return <p className="text-sm text-(--text-muted)">{t("places:stats.insights.loadFailed")}</p>;
  }
  if (!data) return null;

  const scope: EvidenceScopeParams =
    year === null ? { period: "allTime" } : { period: "year", year };
  const lifetime = t("places:stats.insights.lifetime");
  const help = (block: string, values: Record<string, unknown> = {}) =>
    helpText(t, `places:stats.insights.${block}`, values);
  const category = (key: string): string => t(`places:categories.${key}`, { defaultValue: key });

  const discoveries = totalFor(data.totals, "placeDiscoveryVisits", year);
  const revisits = totalFor(data.totals, "placeRevisitVisits", year);
  const unordered =
    year === null
      ? data.discoveries.byYear.reduce((s, y) => s + y.unordered, 0)
      : (data.discoveries.byYear.find((y) => y.year === year)?.unordered ?? 0);

  const doc =
    year === null
      ? data.documentation
      : (data.documentation.byYear.find((y) => y.year === year) ?? null);
  const pct = (part: number, whole: number): string =>
    whole > 0 ? `${Math.round((part / whole) * 100)} %` : "–";

  const trips = data.diversity.trips.filter((d) => year === null || d.year === year);
  const tripMax = trips.reduce((m, d) => Math.max(m, d.categories.length), 0);
  const yearCategories = data.diversity.byYear.find((y) => y.year === year)?.categories ?? null;

  const gap = data.revisits.longestGap;
  const jump = data.jump.longest;

  return (
    <section className="mt-8 flex flex-col gap-4" data-testid="poi-insights">
      <h2 className="text-lg font-semibold">{t("places:stats.insights.title")}</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InsightTile
          testId="insight-discoveries"
          title={t("places:stats.insights.discoveries.title")}
          accent={accent}
          value={
            discoveries + revisits > 0 ? (
              <>
                <EvidenceNumber
                  evidenceKey="placeDiscoveryVisits"
                  scope={scope}
                  renderedValue={discoveries}
                  label={t("places:stats.insights.discoveries.new")}
                >
                  {nf.format(discoveries)}
                </EvidenceNumber>
                {" / "}
                <EvidenceNumber
                  evidenceKey="placeRevisitVisits"
                  scope={scope}
                  renderedValue={revisits}
                  label={t("places:stats.insights.discoveries.again")}
                >
                  {nf.format(revisits)}
                </EvidenceNumber>
              </>
            ) : null
          }
          empty={t("places:stats.insights.discoveries.empty")}
          description={t("places:stats.insights.discoveries.description")}
          help={help("discoveries", {
            unordered,
            withoutDate: data.discoveries.placesWithoutDatedVisit,
            undated: data.discoveries.undatedVisits,
          })}
        >
          {year === null && data.discoveries.byYear.length > 1 && (
            <ul
              className="mt-2 space-y-0.5 text-xs opacity-75"
              data-testid="insight-discoveries-years"
            >
              {data.discoveries.byYear.map((y) => (
                <li key={y.year}>
                  {t("places:stats.insights.discoveries.yearRow", {
                    year: y.year,
                    discoveries: y.discoveries,
                    revisits: y.revisits,
                  })}
                </li>
              ))}
            </ul>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-returning"
          title={t("places:stats.insights.returning.title")}
          accent={accent}
          value={
            gap
              ? gap.days >= 365
                ? t("places:stats.insights.returning.years", {
                    count: data.revisits.longestGapYears,
                  })
                : t("places:stats.insights.returning.days", { count: gap.days })
              : null
          }
          empty={t("places:stats.insights.returning.empty")}
          description={lifetime}
          help={help("returning")}
          entries={data.revisits.returning.slice(0, 10).map((r) => ({
            key: r.placeId,
            href: `/places/${r.placeId}`,
            label: r.name,
            detail: r.years.join(" · "),
          }))}
        >
          {gap && (
            <p className="mt-2 text-sm" data-testid="insight-returning-gap">
              {t("places:stats.insights.returning.gap", { from: gap.from, to: gap.to })}{" "}
              <Link to={`/places/${gap.placeId}`} className="underline underline-offset-2">
                {gap.name}
              </Link>
            </p>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-variety"
          title={t("places:stats.insights.variety.title")}
          accent={accent}
          value={
            trips.length > 0 ? t("places:stats.insights.variety.value", { count: tripMax }) : null
          }
          empty={t("places:stats.insights.variety.empty")}
          description={t("places:stats.insights.variety.description")}
          help={help("variety", { withoutTrip: data.diversity.visitsWithoutTrip })}
          entries={trips.slice(0, 10).map((d) => ({
            key: d.tripId,
            href: `/trips/${d.tripId}`,
            label: d.tripName,
            detail: d.categories.map(category).join(", "),
          }))}
        >
          {year !== null && yearCategories && (
            <p className="mt-2 text-xs opacity-75">
              {t("places:stats.insights.variety.year", {
                count: yearCategories.length,
                year,
              })}
            </p>
          )}
          {year === null && data.diversity.byYear.length > 1 && (
            <p className="mt-2 text-xs opacity-75">
              {data.diversity.byYear.map((y) => `${y.year}: ${y.categories.length}`).join(" · ")}
            </p>
          )}
          {year === null && data.diversity.cities.length > 0 && (
            <p className="mt-1 text-xs opacity-75">
              {t("places:stats.insights.variety.cities", {
                cities: data.diversity.cities
                  .slice(0, 3)
                  .map((c) => `${c.city} (${c.categories.length})`)
                  .join(", "),
              })}
            </p>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-documentation"
          title={t("places:stats.insights.documentation.title")}
          accent={accent}
          value={
            doc && doc.visits > 0 ? (
              <span className="text-2xl">
                <EvidenceNumber
                  evidenceKey="placeVisitsWithPhoto"
                  scope={scope}
                  renderedValue={doc.withPhoto}
                  label={t("places:stats.insights.documentation.photo")}
                >
                  {pct(doc.withPhoto, doc.visits)}
                </EvidenceNumber>
                {" · "}
                <EvidenceNumber
                  evidenceKey="placeVisitsWithNote"
                  scope={scope}
                  renderedValue={doc.withNote}
                  label={t("places:stats.insights.documentation.note")}
                >
                  {pct(doc.withNote, doc.visits)}
                </EvidenceNumber>
                {" · "}
                <EvidenceNumber
                  evidenceKey="placeVisitsWithRating"
                  scope={scope}
                  renderedValue={doc.withRating}
                  label={t("places:stats.insights.documentation.rating")}
                >
                  {pct(doc.withRating, doc.visits)}
                </EvidenceNumber>
              </span>
            ) : null
          }
          empty={t("places:stats.insights.documentation.empty")}
          description={
            doc
              ? t("places:stats.insights.documentation.description", {
                  photo: doc.withPhoto,
                  note: doc.withNote,
                  rating: doc.withRating,
                  count: doc.visits,
                })
              : undefined
          }
          help={help("documentation")}
        />

        <InsightTile
          testId="insight-jump"
          title={t("places:stats.insights.jump.title")}
          accent={accent}
          value={
            jump
              ? t("places:stats.insights.jump.value", { km: nf.format(Math.round(jump.km)) })
              : null
          }
          empty={t("places:stats.insights.jump.empty")}
          description={lifetime}
          help={help("jump", {
            uncertain: data.jump.uncertainPairs,
            undated: data.jump.undatedVisits,
          })}
          entries={
            jump
              ? [
                  {
                    key: jump.from.visitId,
                    href: `/places/${jump.from.placeId}`,
                    label: jump.from.name,
                    detail: jump.from.day,
                  },
                  {
                    key: jump.to.visitId,
                    href: `/places/${jump.to.placeId}`,
                    label: jump.to.name,
                    detail: jump.to.day,
                  },
                ]
              : undefined
          }
        />
      </div>
    </section>
  );
}
