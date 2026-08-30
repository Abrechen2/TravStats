// 12-month × 31-day heatmap for the selected year. Each cell counts how
// many domains were active on that day. Hover surfaces the per-domain
// breakdown. Cell color = the dominant domain's brand color.
import type { JSX } from "react";
import { useMemo, useState } from "react";
import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../../../shared/domains";
import type { DomainStatsMap } from "../../../lib/stats/domain-stats";
import { useTranslation } from "../../../hooks/useTranslation";
import { isWithData } from "./aggregate";
import { useDomainColors } from "../../../hooks/useDomainColors";
import { needsOutline } from "../../../lib/domainColor";

interface Props {
  statsMap: DomainStatsMap;
  visible: Partial<Record<DomainKey, boolean>>;
  year: number;
}

interface CellData {
  total: number;
  perDomain: Partial<Record<DomainKey, number>>;
}

const MONTH_KEY = "stats:overviewHeatmap.months";

export default function CrossDomainHeatmap({ statsMap, visible, year }: Props): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const { colorOf } = useDomainColors();
  const [hover, setHover] = useState<{ m: number; d: number } | null>(null);

  // Lookup per-day per-domain. Build once per render.
  const grid = useMemo(() => {
    const out: Record<string, CellData> = {};
    for (const [key, stats] of Object.entries(statsMap) as Array<
      [DomainKey, (typeof statsMap)[DomainKey]]
    >) {
      if (!stats || !isWithData(stats)) continue;
      if (visible[key] === false) continue;
      for (const [ymd, value] of Object.entries(stats.dailyActiveDays)) {
        if (!ymd.startsWith(`${year}-`)) continue;
        const cell = out[ymd] ?? { total: 0, perDomain: {} };
        cell.perDomain[key] = (cell.perDomain[key] ?? 0) + value;
        cell.total += value;
        out[ymd] = cell;
      }
    }
    return out;
  }, [statsMap, visible, year]);

  const months = [
    t(`${MONTH_KEY}.jan`),
    t(`${MONTH_KEY}.feb`),
    t(`${MONTH_KEY}.mar`),
    t(`${MONTH_KEY}.apr`),
    t(`${MONTH_KEY}.may`),
    t(`${MONTH_KEY}.jun`),
    t(`${MONTH_KEY}.jul`),
    t(`${MONTH_KEY}.aug`),
    t(`${MONTH_KEY}.sep`),
    t(`${MONTH_KEY}.oct`),
    t(`${MONTH_KEY}.nov`),
    t(`${MONTH_KEY}.dec`),
  ];

  return (
    <div
      className="rounded-lg p-6"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {t("stats:overviewHeatmap.title", { year })}
        </h3>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("stats:overviewHeatmap.subtitle")}
        </span>
      </div>
      <div
        className="grid gap-[3px] mt-3 text-[10px]"
        style={{ gridTemplateColumns: "80px repeat(31, 1fr)" }}
      >
        <div />
        {Array.from({ length: 31 }, (_, i) => (
          <div key={i} className="text-center" style={{ color: "var(--text-muted)" }}>
            {(i + 1) % 5 === 0 || i === 0 ? i + 1 : ""}
          </div>
        ))}
        {months.map((mLabel, mIndex) => {
          const daysInMonth = new Date(year, mIndex + 1, 0).getDate();
          return (
            <FragmentRow
              key={mLabel}
              mIndex={mIndex}
              mLabel={mLabel}
              year={year}
              daysInMonth={daysInMonth}
              grid={grid}
              hover={hover}
              setHover={setHover}
              t={t}
              colorOf={colorOf}
            />
          );
        })}
      </div>
      <div
        className="flex items-center gap-1.5 mt-3 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <span>{t("stats:overviewHeatmap.legendLess")}</span>
        <div className="flex gap-[2px]">
          {[0.15, 0.3, 0.5, 0.75, 1].map((o, i) => (
            <div
              key={i}
              style={{
                width: 14,
                height: 14,
                borderRadius: 2,
                background: "var(--accent)",
                opacity: o,
              }}
            />
          ))}
        </div>
        <span>{t("stats:overviewHeatmap.legendMore")}</span>
      </div>
    </div>
  );
}

function FragmentRow({
  mIndex,
  mLabel,
  year,
  daysInMonth,
  grid,
  hover,
  setHover,
  t,
  colorOf,
}: {
  mIndex: number;
  mLabel: string;
  year: number;
  daysInMonth: number;
  grid: Record<string, CellData>;
  hover: { m: number; d: number } | null;
  setHover: (h: { m: number; d: number } | null) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** Handed down like `t` rather than re-read per row — one source, twelve rows. */
  colorOf: (domain: DomainKey) => string;
}): JSX.Element {
  return (
    <>
      <div className="text-xs font-mono self-center" style={{ color: "var(--text-muted)" }}>
        {mLabel}
      </div>
      {Array.from({ length: 31 }, (_, dIndex) => {
        const dayNumber = dIndex + 1;
        if (dayNumber > daysInMonth) {
          return <div key={dIndex} style={{ background: "transparent" }} />;
        }
        const ymd = `${year}-${String(mIndex + 1).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
        const cell = grid[ymd];
        if (!cell || cell.total === 0) {
          return (
            <div
              key={dIndex}
              style={{ aspectRatio: "1", borderRadius: 2, background: "var(--bg-elevated)" }}
            />
          );
        }
        // A day can hold a flight AND a hotel night AND a place visit, and the
        // cell used to paint only whichever was largest — so half of a busy day
        // was invisible and the grid quietly under-reported the mixed ones
        // (Alex, 2026-08-29). The cell is now split in proportion to what
        // actually happened on it.
        //
        // Proportional rather than equal stripes: two flights and one stay is
        // not the same day as one flight and two stays, and equal thirds would
        // draw them identically.
        const slices = domainSlices(cell.perDomain, colorOf);
        const dominant = pickDominant(cell.perDomain);
        const color = colorOf(dominant);
        const opacity = 0.25 + Math.min(cell.total / 3, 1) * 0.65;
        const showTip = hover && hover.m === mIndex && hover.d === dIndex;
        return (
          <div
            key={dIndex}
            className="relative cursor-default"
            onMouseEnter={(): void => setHover({ m: mIndex, d: dIndex })}
            onMouseLeave={(): void => setHover(null)}
            style={{
              aspectRatio: "1",
              borderRadius: 2,
              // One domain paints flat; several paint as hard-edged bands. A
              // gradient would blur two real colours into a third that means
              // nothing.
              background:
                slices.length > 1
                  ? `linear-gradient(to bottom, ${slices
                      .map(({ hex, from, to }) => `${hex} ${from}%, ${hex} ${to}%`)
                      .join(", ")})`
                  : color,
              opacity,
              // See the chart: the pick is honoured, an edge keeps it visible.
              outline: needsOutline(color) ? "1px solid rgba(255,255,255,0.22)" : undefined,
              outlineOffset: -1,
            }}
          >
            {showTip && (
              <div
                className="absolute z-10 left-1/2 bottom-[110%] -translate-x-1/2 whitespace-nowrap pointer-events-none rounded-sm px-2 py-1 text-xs"
                style={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                  color: "var(--text-primary)",
                }}
              >
                <strong>
                  {mLabel} {dayNumber}
                </strong>
                {": "}
                {Object.entries(cell.perDomain)
                  .map(([k, v]) => `${t(`common:${DOMAINS[k as DomainKey].i18nKey}`)} ${v}`)
                  .join(" · ")}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function pickDominant(perDomain: Partial<Record<DomainKey, number>>): DomainKey {
  let best: DomainKey = "flight";
  let bestVal = -Infinity;
  for (const [key, value] of Object.entries(perDomain) as Array<[DomainKey, number]>) {
    if (value > bestVal) {
      best = key;
      bestVal = value;
    }
  }
  return best;
}

/**
 * A day's domains as contiguous bands, in a stable order.
 *
 * Ordered by the domain table rather than by size, so a run of days does not
 * shuffle its stripes as the mix changes — a grid that reorders itself row by
 * row is unreadable even when every individual cell is correct.
 *
 * Bands are expressed as from/to percentages and each colour is emitted twice,
 * which is what turns a CSS gradient into hard edges. Blending would mix two
 * real domain colours into a third that stands for nothing.
 */
export function domainSlices(
  perDomain: Partial<Record<DomainKey, number>>,
  colorOf: (domain: DomainKey) => string,
): Array<{ domain: DomainKey; hex: string; from: number; to: number }> {
  const present = AVAILABLE_DOMAINS.map((domain) => ({
    domain,
    count: perDomain[domain] ?? 0,
  })).filter((entry) => entry.count > 0);

  const total = present.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return [];

  let cursor = 0;
  return present.map((entry, index) => {
    const from = cursor;
    // The last band closes at exactly 100 rather than at a rounded sum, or a
    // hairline of the cell background shows through the bottom edge.
    const to = index === present.length - 1 ? 100 : from + (entry.count / total) * 100;
    cursor = to;
    return { domain: entry.domain, hex: colorOf(entry.domain), from, to };
  });
}
