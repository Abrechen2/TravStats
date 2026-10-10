import { useMemo } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import type { RoadtripInsights } from "../../../types/statsInsights";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import EvidenceNumber from "../EvidenceNumber";
import InsightTile from "../insight/InsightTile";
import { totalFor } from "../insight/insightFold";
import { countingSource } from "../counting/countingEntry";
import RankedBarList, { type RankedRow } from "../lodging/RankedBarList";

const STYLES = ["pitch", "campsite", "lodging"] as const;
const SOURCES = ["track", "routed", "drawn", "straight"] as const;

/**
 * The roadtrip insights (forgejo#260): what has happened against today and
 * what is planned, day stages, road against ferry, where the nights were
 * slept, and the day tours along the way.
 *
 * The data is loaded by `RoadtripStatsSection`, which also uses it to say how
 * much of its distance tile is still ahead. Every figure follows the server's
 * one timeline rule (`shared/tour/roadtripTimeline.ts`); a roadtrip belongs to
 * the year it started, as everywhere on this tab.
 */
export default function RoadtripInsightsSection({
  data,
  year,
  accent,
}: {
  data: RoadtripInsights;
  year: number | null;
  accent: string;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "stats", "common"]);
  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }),
    [i18n.language]
  );
  const km = (n: number): string => `${nf.format(n)} km`;
  const scope: EvidenceScopeParams =
    year === null ? { period: "allTime" } : { period: "year", year };
  const help = (block: string, values: Record<string, unknown> = {}) =>
    countingSource(`roadtrips:stats.insights.${block}`, values);

  const rows = data.roadtrips.filter((r) => year === null || r.year === year);
  const sum = (pick: (r: (typeof rows)[number]) => number): number =>
    rows.reduce((s, r) => s + pick(r), 0);
  const recordedNights = totalFor(data.totals, "roadtripRecordedNights", year);
  const roadKm = totalFor(data.totals, "roadtripDrivenKm", year);
  const ferryKm = totalFor(data.totals, "roadtripFerryKm", year);
  const otherModes = ["rail", "foot", "bike"]
    .map((mode) => ({ mode, km: sum((r) => r.kmByMode[mode] ?? 0) }))
    .filter((m) => m.km > 0);
  const recordedCountries = new Set(rows.flatMap((r) => r.countries.recorded));
  const plannedCountries = new Set(
    rows.flatMap((r) => r.countries.planned).filter((c) => !recordedCountries.has(c))
  );

  const styleRows: RankedRow[] = STYLES.map((style) => ({
    key: style,
    label: t(`roadtrips:stats.insights.nightStyle.${style}`),
    weight: sum((r) => r.nightsByStyle[style]),
    value: nf.format(sum((r) => r.nightsByStyle[style])),
  })).filter((row) => row.weight > 0);
  const unknownStations = sum((r) => r.unknownLengthStations);
  const toursRows = rows.filter((r) => r.tours.completed > 0);

  return (
    <section className="flex flex-col gap-4" data-testid="roadtrip-insights">
      <h2 className="text-lg font-semibold">{t("roadtrips:stats.insights.title")}</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InsightTile
          testId="insight-progress"
          title={t("roadtrips:stats.insights.progress.title")}
          accent={accent}
          value={rows.length > 0 ? km(roadKm) : null}
          evidence={{ key: "roadtripDrivenKm", scope, renderedValue: roadKm }}
          empty={t("roadtrips:stats.insights.progress.empty")}
          description={t("roadtrips:stats.insights.progress.description", {
            current: km(sum((r) => r.roadKm.current)),
            planned: km(sum((r) => r.roadKm.planned + r.roadKm.unplaced)),
          })}
          help={help("progress", { unplaced: km(sum((r) => r.roadKm.unplaced)) })}
        >
          {rows.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs opacity-75">
              <li>
                {t("roadtrips:stats.insights.progress.nights", {
                  planned: nf.format(sum((r) => r.nights.planned)),
                })}{" "}
                <EvidenceNumber
                  evidenceKey="roadtripRecordedNights"
                  scope={scope}
                  renderedValue={recordedNights}
                  label={t("roadtrips:stats.insights.progress.recordedNights")}
                >
                  {nf.format(recordedNights)}
                </EvidenceNumber>
              </li>
              {sum((r) => r.km.recorded - r.roadKm.recorded) > 0 && (
                <li data-testid="insight-progress-other-modes">
                  {t("roadtrips:stats.insights.progress.otherModes", {
                    modes: ["ferry", ...otherModes.map((m) => m.mode)]
                      .map((mode) => ({ mode, km: sum((r) => r.kmByMode[mode] ?? 0) }))
                      .filter((m) => m.km > 0)
                      .map((m) => `${t(`roadtrips:stats.insights.mode.${m.mode}`)} ${km(m.km)}`)
                      .join(" · "),
                  })}
                </li>
              )}
              <li>
                {t("roadtrips:stats.insights.progress.countries", {
                  recorded: [...recordedCountries].sort().join(" · ") || "–",
                  planned: [...plannedCountries].sort().join(" · ") || "–",
                })}
              </li>
              <li data-testid="insight-progress-sources">
                {t("roadtrips:stats.insights.progress.sources", {
                  sources:
                    SOURCES.map((s) => ({ s, km: sum((r) => r.kmBySource[s] ?? 0) }))
                      .filter((x) => x.km > 0)
                      .map((x) => `${t(`roadtrips:stats.insights.source.${x.s}`)} ${km(x.km)}`)
                      .join(" · ") || "–",
                })}
              </li>
            </ul>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-pace"
          title={t("roadtrips:stats.insights.pace.title")}
          accent={accent}
          value={
            data.pace.medianDayKm === null
              ? null
              : t("roadtrips:stats.insights.pace.value", { km: km(data.pace.medianDayKm) })
          }
          // The median's evidence is the driving days it is taken over — the
          // count the description names; the pace is read over all years.
          evidence={{
            key: "roadtripDayStages",
            scope: { period: "allTime" },
            renderedValue: data.pace.dayStages,
          }}
          empty={t("roadtrips:stats.insights.pace.empty")}
          description={t("roadtrips:stats.insights.pace.description", {
            count: data.pace.dayStages,
          })}
          help={help("pace", {
            unstaged: data.pace.unstagedLegs,
            dated: data.pace.fullyDatedTrips,
          })}
        >
          {data.pace.longestDay && (
            <p className="mt-2 text-sm">
              {t("roadtrips:stats.insights.pace.longestDay", {
                km: km(data.pace.longestDay.km),
                day: data.pace.longestDay.day,
              })}{" "}
              <Link
                to={`/roadtrips/${data.pace.longestDay.roadtripId}`}
                className="underline underline-offset-2"
              >
                {data.pace.longestDay.name}
              </Link>
            </p>
          )}
          {data.pace.fullyDatedTrips > 0 && (
            <p className="mt-1 text-xs opacity-75">
              {t("roadtrips:stats.insights.pace.restDays", {
                count: data.pace.restDays,
                trips: data.pace.fullyDatedTrips,
              })}
            </p>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-modes"
          title={t("roadtrips:stats.insights.modes.title")}
          accent={accent}
          value={roadKm + ferryKm > 0 ? km(roadKm) : null}
          evidence={{ key: "roadtripDrivenKm", scope, renderedValue: roadKm }}
          empty={t("roadtrips:stats.insights.modes.empty")}
          // The road is the number; the ferry stands beside it and opens its
          // own legs — carried, never driven.
          description={
            <>
              {t("roadtrips:stats.insights.modes.ferryBefore")}
              <EvidenceNumber
                evidenceKey="roadtripFerryKm"
                scope={scope}
                renderedValue={ferryKm}
                label={t("roadtrips:stats.insights.modes.ferry")}
              >
                {km(ferryKm)}
              </EvidenceNumber>
              {t("roadtrips:stats.insights.modes.ferryAfter")}
            </>
          }
          help={help("modes")}
        >
          {otherModes.length > 0 && (
            <p className="mt-2 text-xs opacity-75">
              {otherModes
                .map((m) => `${t(`roadtrips:stats.insights.mode.${m.mode}`)} ${km(m.km)}`)
                .join(" · ")}
            </p>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-night-style"
          title={t("roadtrips:stats.insights.nightStyle.title")}
          accent={accent}
          value={
            styleRows.length > 0
              ? t("roadtrips:stats.insights.nightStyle.value", {
                  count: styleRows.reduce((s, r) => s + r.weight, 0),
                })
              : null
          }
          // Every recorded night has exactly one style, so the styles add up to
          // the recorded nights — the panel lists them per roadtrip.
          evidence={{
            key: "roadtripRecordedNights",
            scope,
            renderedValue: styleRows.reduce((s, r) => s + r.weight, 0),
          }}
          empty={t("roadtrips:stats.insights.nightStyle.empty")}
          help={help("nightStyle", { unknown: unknownStations })}
          entries={rows
            .filter((r) => r.nights.recorded > 0)
            .map((r) => ({
              key: r.id,
              href: `/roadtrips/${r.id}`,
              label: r.name,
              detail: STYLES.filter((s) => r.nightsByStyle[s] > 0)
                .map(
                  (s) => `${t(`roadtrips:stats.insights.nightStyle.${s}`)} ${r.nightsByStyle[s]}`
                )
                .join(" · "),
            }))}
        >
          {styleRows.length > 0 && (
            <RankedBarList
              title={t("roadtrips:stats.insights.nightStyle.byStyle")}
              rows={styleRows}
              accent={accent}
              emptyLabel={t("roadtrips:stats.insights.nightStyle.empty")}
            />
          )}
          {unknownStations > 0 && (
            <p className="mt-2 text-xs opacity-75">
              {t("roadtrips:stats.insights.nightStyle.unknown", { count: unknownStations })}
            </p>
          )}
        </InsightTile>

        <InsightTile
          testId="insight-tours-along"
          title={t("roadtrips:stats.insights.toursAlong.title")}
          accent={accent}
          value={
            toursRows.length > 0
              ? t("roadtrips:stats.insights.toursAlong.value", {
                  count: sum((r) => r.tours.completed),
                })
              : null
          }
          evidence={{
            key: "roadtripToursAlongCount",
            scope,
            renderedValue: sum((r) => r.tours.completed),
          }}
          empty={t("roadtrips:stats.insights.toursAlong.empty")}
          description={t("roadtrips:stats.insights.toursAlong.description", {
            km: km(sum((r) => r.tours.km)),
          })}
          help={help("toursAlong")}
          entries={toursRows.map((r) => ({
            key: r.id,
            href: `/roadtrips/${r.id}`,
            label: r.name,
            detail: [
              t("roadtrips:stats.insights.toursAlong.row", {
                count: r.tours.completed,
                km: km(r.tours.km),
                driven: km(r.km.recorded),
              }),
              r.tours.ascentM === null
                ? null
                : t("roadtrips:stats.insights.toursAlong.ascent", {
                    m: nf.format(r.tours.ascentM),
                  }),
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
        />
      </div>
    </section>
  );
}
