// Top KPI strip on the Gesamt tab. Cross-domain totals scoped to the
// selected year (or lifetime) with optional year-over-year delta.
import type { JSX } from "react";
import type { YearScopedAgg } from "../../../lib/stats/domain-stats";
import type { AchievementSummary } from "../../../types";
import { DOMAINS, type DomainKey } from "../../../shared/domains";
import type { EvidenceDomain } from "../../../shared/evidence";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";
import { useTranslation } from "../../../hooks/useTranslation";
import DeltaBadge from "./DeltaBadge";
import EvidenceTrigger from "../EvidenceTrigger";
import { delta } from "./aggregate";

interface Props {
  agg: YearScopedAgg;
  prevAgg: YearScopedAgg | null;
  selectedYear: number | null;
  compareYear: number | null;
  compareEnabled: boolean;
  achievements: AchievementSummary | null;
  /** The domains the fold actually read — `foldedDomains`, never the raw chip state. */
  foldedDomains: DomainKey[];
}

/**
 * The evidence contract calls a point of interest a `place` (what the ENTRY
 * is); the domain registry calls it `poi` (what the FEATURE is). One letter
 * of translation, in one place, rather than a cast at each tile.
 */
const EVIDENCE_DOMAIN_OF: Record<DomainKey, EvidenceDomain> = {
  flight: "flight",
  cruise: "cruise",
  lodging: "lodging",
  poi: "place",
};

export default function CrossDomainKpis({
  agg,
  prevAgg,
  selectedYear,
  compareYear,
  compareEnabled,
  achievements,
  foldedDomains,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation(["stats", "common"]);
  // The reader's language decides the thousands separator (#319).
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const showDelta = compareEnabled && prevAgg !== null && selectedYear !== null;

  const breakdown = (Object.entries(agg.perDomainEvents) as Array<[DomainKey, number]>)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} ${t(`common:${DOMAINS[key].i18nKey}`)}`)
    .join(" · ");

  // The population these three numbers were measured over: the period the bar
  // is showing AND the chips that are on. These are the only measures in the
  // registry whose scope carries `domains`, which is why the tile has to send
  // it — an all-time, all-domain default would answer a different question.
  const scope: EvidenceScopeParams = {
    period: selectedYear === null ? "allTime" : "year",
    ...(selectedYear === null ? {} : { year: selectedYear }),
    domains: foldedDomains.map((domain) => EVIDENCE_DOMAIN_OF[domain]),
  };

  const cards: Array<{
    label: string;
    value: string | number;
    hint?: string;
    delta?: ReturnType<typeof delta> | null;
    /** Omitted where release 1 serves no resolver for the figure. */
    evidenceKey?: string;
  }> = [
    {
      label: t("stats:overviewKpis.experiences"),
      value: agg.totalEvents,
      hint: breakdown || t("stats:overviewKpis.noEnabledDomains"),
      delta: showDelta && prevAgg ? delta(agg.totalEvents, prevAgg.totalEvents) : null,
      evidenceKey: "crossDomainEventCount",
    },
    {
      label: t("stats:overviewKpis.countries"),
      value: agg.countriesCount,
      delta: showDelta && prevAgg ? delta(agg.countriesCount, prevAgg.countriesCount) : null,
      evidenceKey: "crossDomainCountryCount",
    },
    {
      label: t("stats:overviewKpis.activeDays"),
      value: agg.activeDays,
      hint: t("stats:overviewKpis.activeDaysHint"),
      delta: showDelta && prevAgg ? delta(agg.activeDays, prevAgg.activeDays) : null,
      evidenceKey: "crossDomainActiveDayCount",
    },
    {
      label: t("stats:overviewKpis.achievements"),
      value: achievements?.unlockedAchievements ?? 0,
      // Unlocks carry no year here, so under a year heading the tile says it
      // counts all years rather than implying they were earned in this one
      // (CT106 audit B03).
      hint:
        [
          achievements && achievements.totalPoints > 0
            ? t("stats:overviewKpis.achievementsHint", { points: achievements.totalPoints })
            : null,
          selectedYear !== null ? t("stats:overviewCard.allYearsOnly") : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    },
  ];

  return (
    // Round 4: the figure first and large, then what it counts — the label
    // used to stand above in the same weight as the hint below.
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const body = (
          <>
            <p
              style={{
                fontSize: 30,
                fontWeight: 700,
                lineHeight: 1.1,
                color: "var(--ts-text-bright)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {typeof c.value === "number" ? c.value.toLocaleString(locale) : c.value}
            </p>
            <h3 className="t-caption">{c.label}</h3>
            {c.delta && <DeltaBadge d={c.delta} compareYear={compareYear} />}
            {c.hint && <p className="t-caption">{c.hint}</p>}
          </>
        );
        // Tailwind's preflight zeroes a button's border and background, so
        // the same className renders identically as a `<button>` — the card
        // keeps its layout and gains a keyboard-operable trigger.
        const className = "flex min-w-0 flex-col";
        const style = {
          gap: 4,
          padding: "var(--ts-space-lg) var(--ts-space-xl)",
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
        };
        // The achievements tile is release 2 (`crossDomainUnlockedAchievementCount`
        // is `servedIn: 2`), so it stays a plain card: a pointer cursor over a
        // 404 is #330 with an extra round trip.
        if (!c.evidenceKey) {
          return (
            <div key={c.label} className={className} style={style}>
              {body}
            </div>
          );
        }
        return (
          <EvidenceTrigger
            key={c.label}
            kind="metric"
            evidenceKey={c.evidenceKey}
            scope={scope}
            renderedValue={typeof c.value === "number" ? c.value : null}
            label={c.label}
            className={className}
            style={style}
          >
            {body}
          </EvidenceTrigger>
        );
      })}
    </div>
  );
}
