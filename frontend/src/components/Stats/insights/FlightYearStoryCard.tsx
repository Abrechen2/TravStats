import type { JSX } from "react";
import { Link } from "react-router-dom";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import EvidenceCount from "./EvidenceCount";
import { InsightHeading } from "./InsightHelp";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import type { FlightYearStory } from "../../../types/flightInsights";

/**
 * The year's story (forgejo#256): new ground, the biggest change against the
 * year before, the curious repetition and the fun facts of the year. Each beat
 * the server could not prove is said to be absent, never filled.
 */
export default function FlightYearStoryCard({
  story,
  year,
  nameOf,
}: {
  story: FlightYearStory | null;
  year: number | null;
  nameOf: (code: string) => string;
}): JSX.Element {
  const { t } = useTranslation(["stats"]);
  const fmt = useInsightFormat();
  const muted = { color: "var(--text-muted)" };

  if (story === null) {
    return (
      <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
        <InsightHeading
          id="insights-story"
          title={t("stats:insights.story.titleNoYear")}
          topic="story"
        />
        <p className="text-sm" style={muted}>
          {year === null
            ? t("stats:insights.empty")
            : t("stats:insights.story.noFlightsInYear", { year })}
        </p>
      </div>
    );
  }

  const change = story.biggestChange;
  const repetition = story.curiousRepetition;
  const fun = story.funFacts;
  const changeValue = (value: number): string => fmt.num(Math.round(value));

  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
      <InsightHeading
        id="insights-story"
        title={t("stats:insights.story.title", { year: story.year })}
        topic="story"
      />
      {year === null && (
        <p className="mb-3 text-xs" style={muted}>
          {t("stats:insights.story.latestYearHint")}
        </p>
      )}
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium">{t("stats:insights.story.newAirports")}</dt>
          <dd style={muted}>
            {story.newAirports.length === 0 ? (
              t("stats:insights.story.noNewAirports")
            ) : (
              <EvidenceCount
                evidenceKey="flightNewAirportsCount"
                scope={{ period: "year", year: story.year }}
                value={story.newAirports.length}
                label={t("stats:insights.story.newAirports")}
              >
                {story.newAirports.map(nameOf).join(", ")}
              </EvidenceCount>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t("stats:insights.story.biggestChange")}</dt>
          <dd style={muted}>
            {change === null
              ? t("stats:insights.story.noComparison", { previousYear: story.year - 1 })
              : t("stats:insights.story.change", {
                  measure: t(`stats:insights.story.measures.${change.measure}`),
                  previous: changeValue(change.previous),
                  current: changeValue(change.current),
                  delta: `${change.ratio > 0 ? "+" : ""}${fmt.pct(change.ratio)}`,
                  previousYear: change.previousYear,
                })}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t("stats:insights.story.repetition")}</dt>
          <dd style={muted}>
            {repetition === null && t("stats:insights.story.noRepetition")}
            {repetition?.kind === "reunion" && (
              <>
                {t("stats:insights.story.reunion", {
                  count: repetition.reunion.years,
                  airport: nameOf(repetition.reunion.airport),
                  from: fmt.day(repetition.reunion.fromDay),
                  to: fmt.day(repetition.reunion.toDay),
                })}{" "}
                <Link to={`/flights/${repetition.reunion.toFlightId}`} className="underline">
                  {t("stats:insights.openFlight")}
                </Link>
              </>
            )}
            {repetition?.kind === "connection" &&
              t("stats:insights.story.connection", {
                connection: repetition.connection,
                flights: fmt.num(repetition.flights),
              })}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t("stats:insights.story.funFacts")}</dt>
          <dd style={muted}>
            <ul className="list-disc pl-5">
              {fun.fastestDay && (
                <li>
                  {t("stats:insights.story.fastestDay", {
                    date: fmt.day(fun.fastestDay),
                    flights: fmt.num(fun.fastestDayFlights),
                  })}
                </li>
              )}
              {fun.routeMaster && (
                <li>
                  {t("stats:insights.story.routeMaster", {
                    route: fun.routeMaster,
                    flights: fmt.num(fun.routeMasterCount),
                  })}
                </li>
              )}
              <li>{t("stats:insights.story.timezones", { zones: fmt.num(fun.timezones) })}</li>
              <li>
                {story.transfers.shortestMinutes === null
                  ? t("stats:insights.story.noTransfers")
                  : t("stats:insights.story.transfers", {
                      transfers: fmt.num(story.transfers.count),
                      shortest: fmt.duration(story.transfers.shortestMinutes),
                    })}
              </li>
            </ul>
          </dd>
        </div>
      </dl>
    </div>
  );
}
