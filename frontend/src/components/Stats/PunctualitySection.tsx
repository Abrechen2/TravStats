import type { JSX } from "react";
import type { PunctualityStats } from "../../lib/api/stats";
import { useTranslation } from "../../hooks/useTranslation";
import EvidenceTrigger from "./EvidenceTrigger";

export interface PunctualitySectionProps {
  /**
   * The delay aggregates, loaded by the page (forgejo#49) — this section used
   * to fetch `/stats/punctuality` itself, and is now one section of
   * `/stats/page`.
   *
   * `undefined` (in flight) and `null` (the shared load failed) both render
   * nothing, which is also what no delay sample renders — so unlike the three
   * ranking cards this section needs no separate message: it has never had one.
   */
  stats: PunctualityStats | null | undefined;
}

/**
 * Punctuality (#2): 2.5 recorded a delay per flight; this is the first place
 * that summarises it — average delay, on-time rate, and the best/worst airline
 * and worst route. Self-HIDING: renders nothing until there is a delay sample,
 * so a logbook without delay data shows no empty panel.
 */
export default function PunctualitySection({ stats }: PunctualitySectionProps): JSX.Element | null {
  const { t } = useTranslation(["stats"]);

  if (!stats || stats.sampleSize === 0) return null;

  const grp = (g: PunctualityStats["bestAirline"]): string =>
    g ? `${g.key} (${g.avgDelayMinutes} min · ${g.flights})` : "—";

  const tiles: Array<{ label: string; value: string }> = [
    {
      label: t("stats:punctuality.avgDelay"),
      value: t("stats:punctuality.minutes", { count: Math.round(stats.avgDelayMinutes) }),
    },
    {
      label: t("stats:punctuality.onTimeRate"),
      value: `${Math.round(stats.onTimeRate * 100)} %`,
    },
    { label: t("stats:punctuality.bestAirline"), value: grp(stats.bestAirline) },
    { label: t("stats:punctuality.worstAirline"), value: grp(stats.worstAirline) },
    { label: t("stats:punctuality.worstRoute"), value: grp(stats.worstRoute) },
  ];

  return (
    <section className="mb-8">
      <h2 className="text-3xl font-bold mb-2" style={{ color: "var(--text-primary)" }}>
        {t("stats:punctuality.title")}
      </h2>
      {/* The sample size lives IN this sentence — the surface inventory names
          it "shown in the subtitle" rather than a tile of its own, so the
          whole line becomes the control (`punctualitySampleSize`, servedIn 1;
          every other punctuality figure here is servedIn 2 and stays plain
          text). */}
      <EvidenceTrigger
        kind="metric"
        evidenceKey="punctualitySampleSize"
        scope={{ period: "allTime" }}
        renderedValue={stats.sampleSize}
        label={t("stats:punctuality.subtitle", { count: stats.sampleSize })}
        // `block` for the same reason as the airlines line in
        // `StatsFlightBreakdown`: this replaced a `<p>`, and an inline-block
        // button reserves descender space a paragraph does not.
        className="mb-6 block text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        {t("stats:punctuality.subtitle", { count: stats.sampleSize })}
      </EvidenceTrigger>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-xl p-4"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          >
            <div
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              {tile.label}
            </div>
            <div className="text-base font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
              {tile.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
