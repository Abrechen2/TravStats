import type { JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDomainColors } from "../../../hooks/useDomainColors";
import type { LodgingStats } from "../../../types/lodging";
import StatCard from "../StatCard";
import CountingHelp from "../counting/CountingHelp";
import type { CountingEntry } from "../counting/countingEntry";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import RankedBarList, { type RankedRow } from "./RankedBarList";

interface Props {
  stats: LodgingStats;
  /**
   * The population the numbers on this surface were measured over, present
   * only where a tile may open the evidence panel. The statistics page passes
   * it; the dashboard map tab and the lodging list page do not, and their
   * cards stay plain — a trigger there would open a panel scoped to a period
   * that screen never shows.
   */
  evidenceScope?: EvidenceScopeParams;
}

const LIST_LIMIT = 8;

/**
 * Records and firsts — and the ranking a tester asked for by name.
 *
 * "Ketten nach Nächten" already answered which BRAND the nights went to. It
 * could not answer which HOUSE, which is the question a person actually asks
 * about their own year (Alex, 2026-08-29). `lodgingNightsRanked` comes from the
 * same pass over the same stays as the chain ranking, so the two can never
 * disagree about a night.
 *
 * The rest are figures the rollup has been carrying and nothing displayed: the
 * longest single stay, how often one hotel was returned to, the stays that were
 * flawless and the ones that were endured.
 */
export default function LodgingRecordsSection({ stats, evidenceScope }: Props): JSX.Element | null {
  const { t } = useTranslation(["lodging", "common"]);
  const { colorOf } = useDomainColors();
  const accent = colorOf("lodging");

  // ABSENT is not EMPTY. An older backend simply does not send this list, and
  // treating that as "no completed stay" printed exactly that sentence next to
  // a card reading "longest stay: 3 nights" — a screen contradicting itself
  // during a version mismatch. Absent hides the list; empty says there is none.
  const ranked = stats.loyalty.lodgingNightsRanked;
  const rankingAvailable = Array.isArray(ranked);
  const maxNights = Math.max(...(ranked ?? []).map((r) => r.nights), 1);

  const rows: RankedRow[] = (ranked ?? []).map((row) => ({
    key: row.key,
    label: row.key,
    weight: row.nights / maxNights,
    value: t("lodging:stats.records.nightsCount", { count: row.nights }),
    hint: row.stays > 1 ? t("lodging:stats.records.staysCount", { count: row.stays }) : null,
  }));

  const cards: JSX.Element[] = [];
  // The counting help names the cards that are drawn, and only those.
  const help: CountingEntry[] = [];
  // A record names one stay or one house; it opens the stays it was found
  // among — every stay with its nights for the longest, every stay for the
  // most returns — where the record holder is one row of the list.
  const among = (key: string) =>
    evidenceScope
      ? { kind: "metric" as const, key, scope: evidenceScope, renderedValue: null }
      : undefined;

  if (stats.longestStayNights > 0) {
    help.push({
      term: t("lodging:stats.records.longestStay"),
      helpKey: "lodging:stats.help.longestStay",
      values: { unknown: stats.staysWithUnknownLength ?? 0 },
    });

    cards.push(
      <StatCard
        key="longest"
        accent={accent}
        valueSize="md"
        title={t("lodging:stats.records.longestStay")}
        evidence={among("lodgingNightsTotal")}
        value={stats.longestStayNights}
        description={t("lodging:stats.records.longestStayDesc")}
      />
    );
  }

  if (stats.sameHotelRepeatMax > 1) {
    help.push({
      term: t("lodging:stats.records.mostReturns"),
      helpKey: "lodging:stats.help.mostReturns",
    });

    cards.push(
      <StatCard
        key="repeat"
        accent={accent}
        valueSize="md"
        title={t("lodging:stats.records.mostReturns")}
        evidence={among("lodgingStaysCount")}
        value={stats.sameHotelRepeatMax}
        description={t("lodging:stats.records.mostReturnsDesc")}
      />
    );
  }

  if (stats.perfectStays > 0 || stats.enduredStays > 0) {
    help.push({
      term: t("lodging:stats.records.perfectStays"),
      helpKey: "lodging:stats.help.perfectStays",
    });

    cards.push(
      <StatCard
        key="perfect"
        accent={accent}
        valueSize="md"
        title={t("lodging:stats.records.perfectStays")}
        value={stats.perfectStays}
        evidence={
          evidenceScope
            ? {
                kind: "metric",
                key: "lodgingPerfectStayCount",
                scope: evidenceScope,
                renderedValue: stats.perfectStays,
              }
            : undefined
        }
        description={t("lodging:stats.records.perfectStaysDesc", {
          endured: stats.enduredStays,
        })}
      />
    );
  }

  if (stats.oneNightStays > 0) {
    help.push({
      term: t("lodging:stats.records.oneNighters"),
      helpKey: "lodging:stats.help.oneNighters",
    });

    cards.push(
      <StatCard
        key="onenight"
        accent={accent}
        valueSize="md"
        title={t("lodging:stats.records.oneNighters")}
        value={stats.oneNightStays}
        evidence={
          evidenceScope
            ? {
                kind: "metric",
                key: "lodgingOneNightStayCount",
                scope: evidenceScope,
                renderedValue: stats.oneNightStays,
              }
            : undefined
        }
        description={t("lodging:stats.records.oneNightersDesc", {
          total: stats.staysCount,
        })}
      />
    );
  }

  if (cards.length === 0 && !rankingAvailable) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-6 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("lodging:stats.records.title")}
      </h2>

      {cards.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">{cards}</div>
      )}

      {rankingAvailable && (
        <RankedBarList
          title={t("lodging:stats.records.byHotel")}
          rows={rows}
          accent={accent}
          emptyLabel={t("lodging:stats.records.noHotels")}
          limit={LIST_LIMIT}
          moreLabel={(hidden) => t("lodging:stats.records.more", { count: hidden })}
        />
      )}

      <CountingHelp
        testId="lodging-records-help"
        entries={[
          ...help,
          ...(rankingAvailable
            ? [{ term: t("lodging:stats.records.byHotel"), helpKey: "lodging:stats.help.byHotel" }]
            : []),
        ]}
      />
    </section>
  );
}
