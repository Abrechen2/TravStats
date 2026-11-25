import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useSettingsStore } from "../../store/settingsStore";
import { formatNumber } from "../../lib/units";
import { formatMetricValue } from "../../lib/comparison/formatMetric";
import { funStats, rivalryLines, totalsOf, type FunStats } from "../../lib/comparison/funStats";
import { evaluateBadges } from "../../lib/comparison/badges";
import type { LeaderboardRow } from "../../lib/comparison/types";

interface Props {
  self: LeaderboardRow;
  friend: { name: string; row?: LeaderboardRow };
  year: number | null;
}

const metricsOf = (row: LeaderboardRow | undefined): Record<string, number | null> =>
  row?.status === "ok" && row.snapshot ? row.snapshot.metrics : {};

/** Fun figures, rivalry lines and badges for both people — all computed from the signed totals. */
export default function CompareFun({ self, friend, year }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["comparison", "common"]);
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const num = (v: number, digits = 0): string =>
    formatNumber(v, { maximumFractionDigits: digits }, i18n.language);

  const tiles = (s: FunStats, who: "you" | "them"): JSX.Element[] => {
    const defs: [string, number | null, string][] = [
      ["earth", s.earthLaps, s.earthLaps === null ? "" : num(s.earthLaps, 1)],
      ["moon", s.moonPercent, s.moonPercent === null ? "" : num(s.moonPercent, 1)],
      ["air", s.airDays, s.airDays === null ? "" : num(s.airDays, 1)],
      [
        "nights",
        s.nightsInHalfYears,
        s.nightsInHalfYears === null ? "" : num(s.nightsInHalfYears, 1),
      ],
      [
        "avg",
        s.avgFlightKm,
        s.avgFlightKm === null
          ? ""
          : formatMetricValue(s.avgFlightKm, "km", {
              distanceUnit,
              t: (k, o) => tr(k, o),
              language: i18n.language,
            }),
      ],
    ];
    return defs.map(([key, raw, value]) => (
      <li key={key} data-testid={`fun-${who}-${key}`} title={tr(`fun.${key}Hint`)}>
        {raw === null ? <span className="t-caption">—</span> : tr(`fun.${key}`, { value })}
      </li>
    ));
  };

  const mine = totalsOf(self, year);
  const theirs = totalsOf(friend.row, year);
  const lines = rivalryLines(metricsOf(self), metricsOf(friend.row));
  const badgeList = (row: LeaderboardRow | undefined, who: "you" | "them"): JSX.Element => {
    const earned = evaluateBadges(row, year);
    return (
      <ul
        className="m-0 flex list-none flex-wrap p-0"
        style={{ gap: "var(--ts-space-sm)" }}
        data-testid={`badges-${who}`}
      >
        {earned === null && <li className="t-caption">{tr("badges.unknown")}</li>}
        {earned?.length === 0 && <li className="t-caption">{tr("badges.none")}</li>}
        {earned?.map((b) => (
          <li
            key={b.code}
            data-testid={`badge-${who}-${b.code}`}
            title={tr(`badges.${b.code}Hint`)}
            style={{
              border: "1px solid var(--ts-border)",
              borderRadius: "var(--ts-radius-card)",
              padding: "2px var(--ts-space-md)",
            }}
          >
            <span aria-hidden="true">{b.glyph} </span>
            {tr(`badges.${b.code}`)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <section
      data-testid="compare-fun"
      className="flex flex-col"
      style={{ gap: "var(--ts-space-lg)" }}
    >
      <h3 className="t-section-label">{tr("fun.title")}</h3>
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-xl)" }}>
        {(["you", "them"] as const).map((who) => (
          <div key={who} className="flex-1" style={{ minWidth: 240 }}>
            <strong>{who === "you" ? tr("compare.you") : friend.name}</strong>
            <ul className="m-0 list-none p-0" style={{ marginTop: "var(--ts-space-sm)" }}>
              {tiles(funStats(who === "you" ? mine : theirs), who)}
            </ul>
            <div style={{ marginTop: "var(--ts-space-md)" }}>
              {badgeList(who === "you" ? self : friend.row, who)}
            </div>
          </div>
        ))}
      </div>
      <div data-testid="rivalry">
        <h4 className="t-caption" style={{ margin: 0 }}>
          {tr("fun.rivalryTitle")}
        </h4>
        <ul className="m-0 list-none p-0">
          {lines.length === 0 && <li className="t-caption">{tr("fun.rivalry.none")}</li>}
          {lines.map((l) => (
            <li key={l.metric} data-testid={`rivalry-${l.metric}`}>
              {tr(`fun.rivalry.${l.metric}_${l.ahead}`, { name: friend.name, count: l.gap })}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
