import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useSettingsStore } from "../../store/settingsStore";
import { DOMAINS, type DomainKey } from "../../shared/domains";
import { LEADERBOARD_METRICS } from "../../shared/comparisonMetrics";
import {
  ABSENT_MARKER,
  formatMetricValue,
  type Translate,
} from "../../lib/comparison/formatMetric";
import {
  cellFor,
  diffOf,
  domainSetOf,
  type Cell,
  type Diff,
} from "../../lib/comparison/compareCells";
import type { LeaderboardRow } from "../../lib/comparison/types";
import { TableScroll } from "../ui";

export interface ComparedFriend {
  key: string;
  name: string;
  /** Undefined: the server no longer lists this friend — they stopped sharing back. */
  row?: LeaderboardRow;
}

interface Props {
  self: LeaderboardRow;
  friends: readonly ComparedFriend[];
  year: number | null;
  /** The domains the reader looks at; null shows every one. Cross-domain totals stay as they were. */
  domains: ReadonlySet<DomainKey> | null;
  isEnabled: (domain: DomainKey) => boolean;
}

type Metric = (typeof LEADERBOARD_METRICS)[number];
const METRICS: readonly Metric[] = LEADERBOARD_METRICS;
const CELL = { padding: "var(--ts-space-sm) var(--ts-space-md)", textAlign: "right" as const };

/**
 * Metric | Du | Freund | Differenz, one table per domain in the domain colour. A figure that is
 * withheld, null or partial says why in words; a difference exists only between two real,
 * like-for-like numbers (spec 2026-11-07 §6.5).
 */
export default function CompareTable({
  self,
  friends,
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

  const fmt = (c: Cell, unit: Metric["unit"]): string =>
    c.value === null
      ? ABSENT_MARKER
      : `${c.partial ? "≥ " : ""}${formatMetricValue(c.value, unit, ctx)}`;
  const reasonText = (c: Cell, domain: DomainKey | null, row?: LeaderboardRow): string =>
    tr(`status.${c.reason ?? "unknown"}`, {
      year: row?.sharedYear,
      domain: domain ? tr(`common:${DOMAINS[domain].i18nKey}`) : "",
    });
  const diffText = (d: Diff, unit: Metric["unit"]): string => {
    if (d.kind === "none") return "";
    if (d.kind === "notComparable") return tr("compare.notComparable");
    const sign = d.value > 0 ? "+" : d.value < 0 ? "−" : "";
    return `${sign}${formatMetricValue(Math.abs(d.value), unit, ctx)}`;
  };

  const sections: { domain: DomainKey | null; metrics: readonly Metric[] }[] = [];
  for (const d of Object.keys(DOMAINS) as DomainKey[]) {
    if (!isEnabled(d) || (domains && !domains.has(d))) continue;
    sections.push({ domain: d, metrics: METRICS.filter((m) => m.domain === d) });
  }
  sections.push({ domain: null, metrics: METRICS.filter((m) => m.domain === null) });

  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      {sections.map(({ domain, metrics }) => {
        const rows = metrics.flatMap((m) => {
          const mine = cellFor(self, m.key, year, null);
          const theirs = friends.map((f) => cellFor(f.row, m.key, year, selfDomains));
          // A figure nobody has stays out; one only a withheld friend lacks still shows for me.
          if (mine.value === null && theirs.every((c) => c.value === null)) return [];
          return [{ m, mine, theirs }];
        });
        if (rows.length === 0) return null;
        const heading = domain
          ? tr(`common:${DOMAINS[domain].i18nKey}`)
          : tr("compare.crossDomain");
        const id = `compare-${domain ?? "cross"}`;
        return (
          <section key={id} data-testid={id}>
            <h3
              id={`${id}-h`}
              className="t-section-label"
              style={{
                borderLeft: `var(--ts-space-xs) solid ${domain ? colorOf(domain) : "var(--ts-accent)"}`,
                paddingLeft: "var(--ts-space-md)",
                marginBottom: "var(--ts-space-sm)",
              }}
            >
              {heading}
              {domain === null && domains !== null && (
                <span className="t-caption" style={{ marginLeft: "var(--ts-space-md)" }}>
                  {tr("friends.crossDomainNote")}
                </span>
              )}
            </h3>
            <TableScroll labelledBy={`${id}-h`}>
              <table className="w-full" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr className="t-caption">
                    <th scope="col" style={{ ...CELL, textAlign: "left" }}>
                      {tr("compare.metric")}
                    </th>
                    <th scope="col" style={CELL}>
                      {tr("compare.you")}
                    </th>
                    {friends.map((f) => (
                      <th key={f.key} scope="colgroup" colSpan={2} style={CELL}>
                        {f.name} · {tr("compare.difference")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ m, mine, theirs }) => (
                    <tr
                      key={m.key}
                      data-testid={`metric-${m.key}`}
                      style={{ borderTop: "1px solid var(--ts-border)" }}
                    >
                      <th scope="row" style={{ ...CELL, textAlign: "left", fontWeight: 500 }}>
                        {tr(`metric.${m.key}`)}
                      </th>
                      <td style={CELL} data-testid={`cell-${m.key}-self`}>
                        {fmt(mine, m.unit)}
                      </td>
                      {friends.map((f, i) => {
                        const c = theirs[i];
                        return [
                          <td
                            key={`${f.key}-v`}
                            style={CELL}
                            data-testid={`cell-${m.key}-${f.key}`}
                          >
                            {c.value === null ? reasonText(c, m.domain, f.row) : fmt(c, m.unit)}
                          </td>,
                          <td
                            key={`${f.key}-d`}
                            style={{ ...CELL, color: "var(--ts-muted)" }}
                            data-testid={`diff-${m.key}-${f.key}`}
                          >
                            {diffText(diffOf(mine, c), m.unit)}
                          </td>,
                        ];
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>
        );
      })}
      <p className="t-caption">{tr("compare.partialHint")}</p>
    </div>
  );
}
