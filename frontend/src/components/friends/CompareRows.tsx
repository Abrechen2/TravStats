import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useSettingsStore } from "../../store/settingsStore";
import { DOMAINS, type DomainKey } from "../../shared/domains";
import { LEADERBOARD_METRICS, type MetricKey } from "../../shared/comparisonMetrics";
import {
  ABSENT_MARKER,
  formatMetricValue,
  type Translate,
} from "../../lib/comparison/formatMetric";
import { cellFor, diffOf, domainSetOf, type Cell } from "../../lib/comparison/compareCells";
import type { LeaderboardRow } from "../../lib/comparison/types";
import FriendAvatar from "./FriendAvatar";

type Metric = (typeof LEADERBOARD_METRICS)[number];
/** The three figures every head card carries; cross-domain, so they exist whatever is switched on. */
const HEAD_METRICS: readonly MetricKey[] = ["daysAway", "countries", "flights"];

interface Props {
  self: LeaderboardRow;
  friend: { name: string; row?: LeaderboardRow };
  year: number | null;
  domains: ReadonlySet<DomainKey> | null;
  isEnabled: (domain: DomainKey) => boolean;
}

type Lead = "you" | "them" | "tie" | null;

/** Who is ahead — only between two real, like-for-like numbers. */
function leadOf(mine: Cell, theirs: Cell): Lead {
  if (diffOf(mine, theirs).kind !== "value" || mine.value === null || theirs.value === null)
    return null;
  return mine.value === theirs.value ? "tie" : mine.value > theirs.value ? "you" : "them";
}

/**
 * Vergleich for one friend: a head card per person with three key figures, then per domain one
 * row per metric with two bars on a shared scale — the longer, bolder one is ahead, so who leads
 * is seen without reading a sign (spec 2026-11-08 §11.5.2). A withheld, partial or unlike figure
 * says why in words and draws no bar against it.
 */
export default function CompareRows({
  self,
  friend,
  year,
  domains,
  isEnabled,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation(["comparison", "common"]);
  const { colorOf } = useDomainColors();
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);
  const tr: Translate = (key, options) => String(t(key, options ?? {}));
  const ctx = { distanceUnit, t: tr, language: i18n.language };
  const selfDomains = domainSetOf(self);
  const row = friend.row;

  const text = (c: Cell, unit: Metric["unit"]): string =>
    c.value === null
      ? ABSENT_MARKER
      : `${c.partial ? "≥ " : ""}${formatMetricValue(c.value, unit, ctx)}`;
  const reason = (c: Cell, domain: DomainKey | null): string =>
    tr(`status.${c.reason ?? "unknown"}`, {
      year: row?.sharedYear,
      domain: domain ? tr(`common:${DOMAINS[domain].i18nKey}`) : "",
    });
  const pair = (m: Metric): { mine: Cell; theirs: Cell } => ({
    mine: cellFor(self, m.key, year, null),
    theirs: cellFor(row, m.key, year, selfDomains),
  });

  const sections: { domain: DomainKey | null; metrics: readonly Metric[] }[] = [];
  for (const d of Object.keys(DOMAINS) as DomainKey[]) {
    if (!isEnabled(d) || (domains && !domains.has(d))) continue;
    sections.push({ domain: d, metrics: LEADERBOARD_METRICS.filter((m) => m.domain === d) });
  }
  sections.push({ domain: null, metrics: LEADERBOARD_METRICS.filter((m) => m.domain === null) });

  const headCard = (who: "you" | "them"): JSX.Element => (
    <div
      className="flex-1"
      data-testid={`head-card-${who}`}
      style={{
        minWidth: 260,
        padding: "var(--ts-space-lg)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
      }}
    >
      <div className="flex items-center" style={{ gap: "var(--ts-space-md)" }}>
        <FriendAvatar name={who === "you" ? tr("compare.you") : friend.name} tone={who} />
        <strong>{who === "you" ? tr("compare.you") : friend.name}</strong>
      </div>
      <dl
        className="grid"
        style={{
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "var(--ts-space-md)",
          margin: "var(--ts-space-lg) 0 0",
        }}
      >
        {HEAD_METRICS.map((key) => {
          const m = LEADERBOARD_METRICS.find((x) => x.key === key);
          if (!m) return null;
          const cell = who === "you" ? pair(m).mine : pair(m).theirs;
          return (
            <div key={key} data-testid={`head-${who}-${key}`}>
              <dd className="t-screen-title" style={{ margin: 0 }}>
                {cell.value === null ? ABSENT_MARKER : text(cell, m.unit)}
              </dd>
              <dt className="t-caption">
                {tr(`metric.${key}`)}
                {cell.value === null && who === "them" ? ` · ${reason(cell, m.domain)}` : ""}
              </dt>
            </div>
          );
        })}
      </dl>
    </div>
  );

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-lg)" }}>
        {headCard("you")}
        {headCard("them")}
      </div>
      {sections.map(({ domain, metrics }) => {
        const rows = metrics.flatMap((m) => {
          const { mine, theirs } = pair(m);
          if (mine.value === null && theirs.value === null) return [];
          return [{ m, mine, theirs }];
        });
        if (rows.length === 0) return null;
        const id = `compare-${domain ?? "cross"}`;
        return (
          <section key={id} data-testid={id} aria-labelledby={`${id}-h`}>
            <h3
              id={`${id}-h`}
              className="t-section-label"
              style={{
                borderLeft: `var(--ts-space-xs) solid ${domain ? colorOf(domain) : "var(--ts-accent)"}`,
                paddingLeft: "var(--ts-space-md)",
                marginBottom: "var(--ts-space-sm)",
              }}
            >
              {domain ? tr(`common:${DOMAINS[domain].i18nKey}`) : tr("compare.crossDomain")}
              {domain === null && domains !== null && (
                <span className="t-caption" style={{ marginLeft: "var(--ts-space-md)" }}>
                  {tr("friends.crossDomainNote")}
                </span>
              )}
            </h3>
            <ul className="m-0 flex list-none flex-col p-0" style={{ gap: "var(--ts-space-md)" }}>
              {rows.map(({ m, mine, theirs }) => (
                <MetricRow
                  key={m.key}
                  metric={m}
                  mine={mine}
                  theirs={theirs}
                  lead={leadOf(mine, theirs)}
                  fmt={text}
                  reason={reason(theirs, m.domain)}
                  name={friend.name}
                  tr={tr}
                />
              ))}
            </ul>
          </section>
        );
      })}
      <p className="t-caption">{tr("compare.partialHint")}</p>
    </div>
  );
}

interface RowProps {
  metric: Metric;
  mine: Cell;
  theirs: Cell;
  lead: Lead;
  fmt: (c: Cell, unit: Metric["unit"]) => string;
  reason: string;
  name: string;
  tr: Translate;
}

/** Two bars on one scale. A bar exists only for a real number; the leader's is solid, the other's softer. */
function MetricRow({ metric, mine, theirs, lead, fmt, reason, name, tr }: RowProps): JSX.Element {
  const top = Math.max(mine.value ?? 0, theirs.value ?? 0);
  const width = (c: Cell): string =>
    top > 0 && c.value !== null ? `${(c.value / top) * 100}%` : "0%";
  const bar = (who: "you" | "them", c: Cell): JSX.Element => {
    const solid = lead === who || lead === "tie" || lead === null;
    return (
      <div className="flex items-center" style={{ gap: "var(--ts-space-md)" }}>
        <div
          className="flex-1"
          style={{
            height: 10,
            background: "var(--ts-border)",
            borderRadius: 5,
            overflow: "hidden",
          }}
        >
          <div
            data-testid={`bar-${metric.key}-${who}`}
            style={{
              width: width(c),
              height: "100%",
              borderRadius: 5,
              background: who === "you" ? "var(--ts-accent)" : "var(--ts-text)",
              opacity: solid ? 1 : 0.4,
            }}
          />
        </div>
        <span
          data-testid={`cell-${metric.key}-${who === "you" ? "self" : "friend"}`}
          style={{ minWidth: 110, textAlign: "right", fontWeight: lead === who ? 700 : 400 }}
        >
          {who === "them" && c.value === null ? reason : fmt(c, metric.unit)}
        </span>
      </div>
    );
  };
  return (
    <li data-testid={`metric-${metric.key}`} data-lead={lead ?? "none"}>
      <div className="flex items-baseline justify-between">
        <span style={{ fontWeight: 500 }}>{tr(`metric.${metric.key}`)}</span>
        {lead === "tie" && <span className="t-caption">{tr("friend.tie")}</span>}
        {lead && lead !== "tie" && (
          <span className="t-caption" data-testid={`lead-${metric.key}`}>
            {lead === "you" ? tr("friend.youLead") : tr("friend.theyLead", { name })}
          </span>
        )}
        {lead === null && mine.value !== null && theirs.value !== null && (
          <span className="t-caption">{tr("compare.notComparable")}</span>
        )}
      </div>
      <div className="flex flex-col" style={{ gap: 4, marginTop: 4 }}>
        {bar("you", mine)}
        {bar("them", theirs)}
      </div>
    </li>
  );
}
