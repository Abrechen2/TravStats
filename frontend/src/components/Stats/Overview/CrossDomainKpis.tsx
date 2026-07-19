// Top KPI strip on the Gesamt tab. Cross-domain totals scoped to the
// selected year (or lifetime) with optional year-over-year delta.
import type { JSX } from "react";
import type { YearScopedAgg } from "../../../lib/stats/domain-stats";
import type { AchievementSummary } from "../../../types";
import { DOMAINS, type DomainKey } from "../../../shared/domains";
import { useTranslation } from "../../../hooks/useTranslation";
import DeltaBadge from "./DeltaBadge";
import { delta } from "./aggregate";

interface Props {
  agg: YearScopedAgg;
  prevAgg: YearScopedAgg | null;
  selectedYear: number | null;
  compareYear: number | null;
  compareEnabled: boolean;
  achievements: AchievementSummary | null;
}

export default function CrossDomainKpis({
  agg,
  prevAgg,
  selectedYear,
  compareYear,
  compareEnabled,
  achievements,
}: Props): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const showDelta = compareEnabled && prevAgg !== null && selectedYear !== null;

  const breakdown = (Object.entries(agg.perDomainEvents) as Array<[DomainKey, number]>)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} ${t(`common:${DOMAINS[key].i18nKey}`)}`)
    .join(" · ");

  const cards: Array<{
    label: string;
    value: string | number;
    hint?: string;
    delta?: ReturnType<typeof delta> | null;
  }> = [
    {
      label: t("stats:overviewKpis.experiences"),
      value: agg.totalEvents,
      hint: breakdown || t("stats:overviewKpis.noEnabledDomains"),
      delta: showDelta && prevAgg ? delta(agg.totalEvents, prevAgg.totalEvents) : null,
    },
    {
      label: t("stats:overviewKpis.countries"),
      value: agg.countriesCount,
      delta: showDelta && prevAgg ? delta(agg.countriesCount, prevAgg.countriesCount) : null,
    },
    {
      label: t("stats:overviewKpis.activeDays"),
      value: agg.activeDays,
      hint: t("stats:overviewKpis.activeDaysHint"),
      delta: showDelta && prevAgg ? delta(agg.activeDays, prevAgg.activeDays) : null,
    },
    {
      label: t("stats:overviewKpis.achievements"),
      value: achievements?.unlockedAchievements ?? 0,
      hint:
        achievements && achievements.totalPoints > 0
          ? t("stats:overviewKpis.achievementsHint", { points: achievements.totalPoints })
          : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg shadow-sm p-6"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
            {c.label}
          </h3>
          <p className="text-3xl font-bold mt-2 font-mono" style={{ color: "var(--text-primary)" }}>
            {typeof c.value === "number" ? c.value.toLocaleString("de-DE") : c.value}
          </p>
          {c.delta && <DeltaBadge d={c.delta} compareYear={compareYear} />}
          {c.hint && (
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              {c.hint}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
