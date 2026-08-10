import { useEffect, useState } from "react";
import type { JSX } from "react";
import { statsApi, type PunctualityStats } from "../../lib/api/stats";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * Punctuality (#2): 2.5 recorded a delay per flight; this is the first place
 * that summarises it — average delay, on-time rate, and the best/worst airline
 * and worst route. Self-fetching and self-hiding: renders nothing until there
 * is a delay sample, so a logbook without delay data shows no empty panel.
 */
export default function PunctualitySection(): JSX.Element | null {
  const { t } = useTranslation(["stats"]);
  const [stats, setStats] = useState<PunctualityStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    statsApi
      .getPunctuality()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((err) => logger.error("Failed to load punctuality stats", err));
    return () => {
      cancelled = true;
    };
  }, []);

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
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        {t("stats:punctuality.subtitle", { count: stats.sampleSize })}
      </p>
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
