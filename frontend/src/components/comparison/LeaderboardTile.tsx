import type { JSX } from "react";
import { Card, ListRow, StatTile } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useDomainColors } from "../../hooks/useDomainColors";
import { useSettingsStore } from "../../store/settingsStore";
import { DOMAINS } from "../../shared/domains";
import { rankPeople, type RankedEntry } from "../../lib/comparison/ranking";
import { ABSENT_MARKER, formatMetricValue } from "../../lib/comparison/formatMetric";
import type { LeaderboardMetric, LeaderboardRow } from "../../lib/comparison/types";

/** En dash, not the em dash of an absent value: an empty rank slot and an empty figure are two different gaps. */
const UNRANKED_MARK = "–";

interface Props {
  metric: LeaderboardMetric;
  rows: readonly LeaderboardRow[];
  year: number | null;
}

/**
 * One figure, the way /stats shows it — a StatTile with the reader's own value — and the
 * people ranked under it. The left edge carries the domain colour from the colour store
 * (never a hard-coded swatch); cross-domain figures use the accent.
 */
export default function LeaderboardTile({ metric, rows, year }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["comparison", "stats", "common"]);
  const { colorOf } = useDomainColors();
  const distanceUnit = useSettingsStore((s) => s.units.distanceUnit);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const ranked = rankPeople(rows, metric.key, year);
  const show = (entry: RankedEntry | undefined): string =>
    !entry || entry.value === null
      ? ABSENT_MARKER
      : `${entry.partial ? "≥ " : ""}${formatMetricValue(entry.value, metric.unit, { distanceUnit, t: tr, language: i18n.language })}`;
  const label = tr(`metric.${metric.key}`);
  return (
    <Card
      data-testid={`metric-${metric.key}`}
      style={{
        borderLeftWidth: "var(--ts-space-xs)",
        borderLeftColor: metric.domain ? colorOf(metric.domain) : "var(--ts-accent)",
      }}
    >
      <StatTile value={show(ranked.find((e) => e.row.person.kind === "self"))} label={label} />
      <ol aria-label={tr("tile.ranking", { metric: label })} className="m-0 list-none p-0">
        {ranked.map((entry) => (
          <li key={entry.row.person.key}>
            <ListRow
              dense
              mark={<span className="t-stat-number">{entry.rank ?? UNRANKED_MARK}</span>}
              title={entry.row.person.kind === "self" ? tr("you") : entry.row.person.displayName}
              subtitle={
                entry.reason
                  ? tr(`status.${entry.reason}`, {
                      year: entry.row.sharedYear,
                      domain: metric.domain ? tr(`common:${DOMAINS[metric.domain].i18nKey}`) : "",
                    })
                  : undefined
              }
              trailing={show(entry)}
            />
          </li>
        ))}
      </ol>
    </Card>
  );
}
