// Compact per-domain summary tile for the cross-domain overview.
// Renders one of two states:
//   - hasData=false: dashed-border placeholder ("noch keine Daten").
//   - hasData=true: header (icon + label + count + delta) over the
//     domain summary's headline KPIs / top-items / badges.
import type { JSX } from "react";
import { DOMAINS, type DomainKey } from "../../../shared/domains";
import type { DomainStats } from "../../../lib/stats/domain-stats";
import { useTranslation } from "../../../hooks/useTranslation";
import DeltaBadge from "./DeltaBadge";
import { delta, isWithData } from "./aggregate";
import { useDomainColors } from "../../../hooks/useDomainColors";

interface Props {
  domain: DomainKey;
  stats: DomainStats | undefined;
  selectedYear: number | null;
  compareYear: number | null;
  compareEnabled: boolean;
}

export default function DomainSummaryCard({
  domain,
  stats,
  selectedYear,
  compareYear,
  compareEnabled,
}: Props): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const d = DOMAINS[domain];
  const { colorOf } = useDomainColors();
  const domainHex = colorOf(domain);

  if (!stats || !isWithData(stats)) {
    return (
      <div
        className="rounded-lg p-5 flex flex-col gap-3"
        style={{
          background: "var(--bg-surface)",
          border: "1px dashed var(--color-border)",
          opacity: 0.6,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-lg"
            style={{
              background: `color-mix(in srgb, ${domainHex} 14%, transparent)`,
            }}
            aria-hidden
          >
            {d.icon}
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {t(`common:${d.i18nKey}`)}
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {d.available ? t("stats:overviewCard.noDataYet") : t("stats:overviewCard.comingSoon")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const yearScopedCount = selectedYear !== null ? (stats.yearlyEvents[selectedYear] ?? 0) : null;
  const compareCount =
    compareEnabled && compareYear !== null ? (stats.yearlyEvents[compareYear] ?? 0) : null;
  const cardDelta =
    yearScopedCount !== null && compareCount !== null ? delta(yearScopedCount, compareCount) : null;

  return (
    <div
      className="rounded-lg p-5 flex flex-col gap-3.5 transition-colors"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-lg"
            style={{
              background: `color-mix(in srgb, ${domainHex} 14%, transparent)`,
            }}
            aria-hidden
          >
            {d.icon}
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {t(`common:${d.i18nKey}`)}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {yearScopedCount !== null
                ? t("stats:overviewCard.yearScopedCount", {
                    year: selectedYear,
                    count: yearScopedCount,
                    lifetime: stats.totalEvents,
                  })
                : t("stats:overviewCard.lifetimeCount", { count: stats.totalEvents })}
            </div>
            {cardDelta && <DeltaBadge d={cardDelta} compareYear={compareYear} />}
          </div>
        </div>
        <a
          href={stats.summary.detailRoute}
          className="text-xs font-medium hover:underline whitespace-nowrap"
          style={{ color: domainHex }}
        >
          {t("stats:overviewCard.detailLink")}
        </a>
      </div>

      <div
        className="grid grid-cols-3 gap-3 pt-3"
        style={{ borderTop: "1px solid var(--color-border)" }}
      >
        {stats.summary.headlineKpis.map((kpi) => (
          <div key={kpi.label}>
            <div
              className="text-[10px] uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              {kpi.label}
            </div>
            <div
              className="text-base font-bold font-mono mt-0.5"
              style={{ color: "var(--text-primary)" }}
            >
              {typeof kpi.value === "number" ? kpi.value.toLocaleString("de-DE") : kpi.value}
            </div>
          </div>
        ))}
      </div>

      {stats.summary.topItems && stats.summary.topItems.items.length > 0 && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          <div style={{ color: "var(--text-muted)" }}>{stats.summary.topItems.title}</div>
          <div className="flex gap-1.5 flex-wrap mt-1">
            {stats.summary.topItems.items.slice(0, 5).map((item) => (
              <span
                key={item.label}
                className="px-2 py-0.5 rounded-full text-xs"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--color-border)",
                  color: "var(--text-primary)",
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {stats.summary.badges && stats.summary.badges.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {stats.summary.badges.map((b) => (
            <span
              key={b.label}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs"
              style={{
                background: `color-mix(in srgb, ${domainHex} 14%, transparent)`,
                color: "var(--text-primary)",
                border: "1px solid var(--color-border)",
              }}
            >
              <span aria-hidden>{b.emoji}</span>
              {b.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
