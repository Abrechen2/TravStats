import type { JSX, ReactNode } from "react";
import type { SeatStats } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { rankingKey } from "../../shared/evidence";
import EvidenceTrigger from "./EvidenceTrigger";
import CountingHelp from "./counting/CountingHelp";

interface StatsSeatSectionProps {
  seatStats: SeatStats | null;
}

const ALL_TIME = { period: "allTime" as const };

/** The server's seat-class values with a label of their own; any other value shows as stored. */
const SEAT_CLASS_KEYS: Record<string, string> = {
  economy: "stats:seatClasses.economy",
  premium_economy: "stats:seatClasses.premiumEconomy",
  business: "stats:seatClasses.business",
  first: "stats:seatClasses.first",
};

interface Bar {
  label: string;
  count: number;
  colour: string;
  /** `seat:<facet>:<value>` — the flights behind this bar (forgejo#256). */
  evidence: string;
}

/**
 * One bar of a distribution: its label, count and share, and the whole row is
 * the button that opens the flights behind it.
 */
function BarRow({ bar, total }: { bar: Bar; total: number }): JSX.Element {
  const pct = total > 0 ? Math.round((bar.count / total) * 100) : 0;
  return (
    <EvidenceTrigger
      kind="ranking"
      evidenceKey={rankingKey("seat", bar.evidence)}
      scope={ALL_TIME}
      renderedValue={bar.count}
      label={bar.label}
      className="mb-2 block"
    >
      <div className="mb-1 flex justify-between text-sm" style={{ color: "var(--text-primary)" }}>
        <span>{bar.label}</span>
        <span>
          {bar.count} ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full rounded-full" style={{ background: "var(--color-border)" }}>
        <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: bar.colour }} />
      </div>
    </EvidenceTrigger>
  );
}

function Distribution({ title, bars }: { title: string; bars: Bar[] }): JSX.Element {
  const total = bars.reduce((sum, bar) => sum + bar.count, 0);
  return (
    <div>
      <h3 className="mb-3 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h3>
      {bars.map((bar) => (
        <BarRow key={bar.evidence} bar={bar} total={total} />
      ))}
    </div>
  );
}

function Tile({
  label,
  evidence,
  children,
}: {
  label: string;
  evidence: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <EvidenceTrigger
      kind="ranking"
      evidenceKey={rankingKey("seat", evidence)}
      scope={ALL_TIME}
      // A seat or a mean row is no number of flights — nothing to recount.
      renderedValue={null}
      label={label}
      className="block rounded-lg p-4"
      style={{ background: "var(--bg-muted)", border: "1px solid var(--color-border)" }}
    >
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
        {children}
      </p>
    </EvidenceTrigger>
  );
}

/**
 * Seats (`/stats/page` → `services/stats/seatStats.ts`). Every bar and tile
 * opens the flights it was counted from (`seat` ranking evidence,
 * forgejo#256), read through the same `seatFactsOf` rule.
 */
export default function StatsSeatSection({ seatStats }: StatsSeatSectionProps): JSX.Element | null {
  const { t } = useTranslation(["stats"]);

  if (!seatStats) return null;

  const hasData =
    seatStats.windowCount + seatStats.middleCount + seatStats.aisleCount + seatStats.unknownCount >
    0;

  const help = [
    { term: t("stats:seats.positionTitle"), helpKey: "flightStatsHelp:seats.position" },
    { term: t("stats:seats.zoneTitle"), helpKey: "flightStatsHelp:seats.zone" },
    { term: t("stats:seats.mostCommon"), helpKey: "flightStatsHelp:seats.mostCommon" },
    { term: t("stats:seats.avgRow"), helpKey: "flightStatsHelp:seats.avgRow" },
    { term: t("stats:seats.seatClassTitle"), helpKey: "flightStatsHelp:seats.seatClass" },
  ];

  const positions: Bar[] = [
    {
      label: t("stats:seats.window"),
      count: seatStats.windowCount,
      colour: "var(--accent)",
      evidence: "position:window",
    },
    {
      label: t("stats:seats.middle"),
      count: seatStats.middleCount,
      colour: "var(--warning)",
      evidence: "position:middle",
    },
    {
      label: t("stats:seats.aisle"),
      count: seatStats.aisleCount,
      colour: "var(--success)",
      evidence: "position:aisle",
    },
  ];
  // Front/middle/back graded in the brand amber (BRAND.md §3: domain colours
  // stay in their domain), strong to soft from the nose back.
  const zones: Bar[] = [
    {
      label: t("stats:seats.front"),
      count: seatStats.frontCount,
      colour: "var(--accent)",
      evidence: "zone:front",
    },
    {
      label: t("stats:seats.middleZone"),
      count: seatStats.middleZoneCount,
      colour: "var(--accent-dim)",
      evidence: "zone:middle",
    },
    {
      label: t("stats:seats.back"),
      count: seatStats.backCount,
      colour: "var(--accent-soft)",
      evidence: "zone:back",
    },
  ];
  const classes: Bar[] = Object.entries(seatStats.seatClassDistribution).map(([cls, count]) => ({
    label: SEAT_CLASS_KEYS[cls] ? t(SEAT_CLASS_KEYS[cls]) : cls,
    count,
    colour: "var(--accent)",
    evidence: `class:${cls}`,
  }));

  return (
    <div className="mt-8">
      <h2 className="mb-6 text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("stats:seats.title")}
      </h2>

      {hasData ? (
        <div
          className="rounded-lg p-6 shadow-sm"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <Distribution title={t("stats:seats.positionTitle")} bars={positions} />
              {/* Abstention is a result: a letter the cabin layout does not
                  decide is counted here, never guessed into a bar. */}
              {seatStats.unknownCount > 0 && (
                <EvidenceTrigger
                  kind="ranking"
                  evidenceKey={rankingKey("seat", "position:unknown")}
                  scope={ALL_TIME}
                  renderedValue={seatStats.unknownCount}
                  label={t("stats:seats.unplaced", { count: seatStats.unknownCount })}
                  className="block text-xs underline decoration-dotted underline-offset-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("stats:seats.unplaced", { count: seatStats.unknownCount })}
                </EvidenceTrigger>
              )}
            </div>
            <Distribution title={t("stats:seats.zoneTitle")} bars={zones} />
            <div className="flex flex-col gap-3">
              {seatStats.mostCommonSeat && (
                <Tile
                  label={t("stats:seats.mostCommon")}
                  evidence={`number:${seatStats.mostCommonSeat}`}
                >
                  {seatStats.mostCommonSeat}
                </Tile>
              )}
              {seatStats.avgRowNumber !== null && (
                <Tile label={t("stats:seats.avgRow")} evidence="row:numbered">
                  {seatStats.avgRowNumber}
                </Tile>
              )}
            </div>
            {classes.length > 0 && (
              <Distribution title={t("stats:seats.seatClassTitle")} bars={classes} />
            )}
          </div>
        </div>
      ) : (
        <div
          className="rounded-lg p-6 text-center shadow-sm"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
        >
          <p style={{ color: "var(--text-muted)" }}>{t("stats:seats.noData")}</p>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("stats:seats.noDataHint")}
          </p>
        </div>
      )}
      <CountingHelp entries={help} testId="seats-counting-help" />
    </div>
  );
}
