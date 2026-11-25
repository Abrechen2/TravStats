import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { formatNumber } from "../../lib/units";
import {
  CURATED_KEYS,
  curatedLead,
  curatedProgress,
  type CuratedProgress,
} from "../../lib/comparison/curatedProgress";
import type { LeaderboardRow } from "../../lib/comparison/types";
import MetricHelp from "./MetricHelp";

interface Props {
  self: LeaderboardRow;
  friend: { name: string; row?: LeaderboardRow };
  year: number | null;
}

/** Progress through the standard lists: "Welterbe: Du 23 / 1.199 · Norbert 41", counts only. */
export default function CompareCurated({ self, friend, year }: Props): JSX.Element | null {
  const { t, i18n } = useTranslation(["comparison", "common"]);
  const { colorOf } = useDomainColors();
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const n = (v: number): string => formatNumber(v, { maximumFractionDigits: 0 }, i18n.language);
  const rows = CURATED_KEYS.map((key) => ({
    key,
    mine: curatedProgress(self, key, year),
    theirs: curatedProgress(friend.row, key, year),
  })).filter((r) => r.mine !== null || r.theirs !== null);
  if (rows.length === 0) return null;
  const bar = (p: CuratedProgress | null, who: "you" | "them", key: string): JSX.Element => (
    <div className="flex items-center" style={{ gap: "var(--ts-space-md)" }}>
      <div
        className="flex-1"
        style={{ height: 10, background: "var(--ts-border)", borderRadius: 5, overflow: "hidden" }}
      >
        <div
          data-testid={`curated-bar-${key}-${who}`}
          style={{
            width: p ? `${(p.visited / p.size) * 100}%` : "0%",
            height: "100%",
            background: who === "you" ? colorOf("poi") : "var(--ts-text)",
            opacity: who === "you" ? 1 : 0.7,
          }}
        />
      </div>
      <span data-testid={`curated-${key}-${who}`} style={{ minWidth: 120, textAlign: "right" }}>
        {p ? tr("curated.of", { visited: n(p.visited), total: n(p.size) }) : "—"}
      </span>
    </div>
  );
  return (
    <section data-testid="compare-curated" aria-labelledby="compare-curated-h">
      <h3
        id="compare-curated-h"
        className="t-section-label"
        style={{
          borderLeft: `var(--ts-space-xs) solid ${colorOf("poi")}`,
          paddingLeft: "var(--ts-space-md)",
        }}
      >
        {tr("curated.title")}
      </h3>
      <p className="t-caption">{tr("curated.hint")}</p>
      <ul className="m-0 flex list-none flex-col p-0" style={{ gap: "var(--ts-space-md)" }}>
        {rows.map(({ key, mine, theirs }) => {
          const lead = curatedLead(mine, theirs);
          const list = tr(`metric.${key}`);
          return (
            <li key={key} data-testid={`curated-row-${key}`}>
              <div className="flex items-baseline justify-between">
                <span style={{ fontWeight: 500 }}>
                  {list} <MetricHelp metric={key} name={list} />
                </span>
                {lead && (
                  <span className="t-caption" data-testid={`curated-lead-${key}`}>
                    {lead.ahead === "you"
                      ? tr("curated.leadYou", { count: lead.gap })
                      : tr("curated.lead", { name: friend.name, count: lead.gap })}
                  </span>
                )}
                {theirs === null && mine !== null && (
                  <span className="t-caption">{tr("curated.oldPeer", { name: friend.name })}</span>
                )}
              </div>
              <div className="flex flex-col" style={{ gap: 4, marginTop: 4 }}>
                {bar(mine, "you", key)}
                {bar(theirs, "them", key)}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
