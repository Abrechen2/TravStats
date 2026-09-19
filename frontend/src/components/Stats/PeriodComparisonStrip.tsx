import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonWindow } from "../../lib/stats/comparisonWindow";
import TrendDelta from "./TrendDelta";
import EvidenceTrigger from "./EvidenceTrigger";
import type { EvidenceScopeParams } from "../evidence/useEvidence";

export interface ComparisonRow {
  key: string;
  label: string;
  current: number;
  previous: number;
  /** Renders a figure; plain grouped digits when omitted. */
  format?: (value: number) => string;
  /**
   * Present only where a RESOLVER answers for this row's CURRENT figure. A
   * strip figure is a number like any other — it became a trigger the same way
   * a tile did (owner, 2026-09-19). The compare year's figure beside it stays
   * plain: it is the same measure over a different population, and the panel
   * would answer for the year the strip is scoped to, not the one printed
   * under it.
   */
  evidenceKey?: string;
}

interface StripEvidence {
  /** The population the CURRENT figures were measured over — the strip's own year. */
  scope: EvidenceScopeParams;
}

interface Props {
  year: number;
  compareYear: number;
  rows: ComparisonRow[];
  /**
   * Omitted, every figure stays plain text however many rows name a key —
   * the same rule `LodgingStatStrip` follows, and for the same reason: a
   * trigger without a scope opens a panel measuring a population this strip
   * never showed.
   */
  evidence?: StripEvidence;
}

/**
 * The headline figures of one domain tab, set against the compare year.
 *
 * One strip for cruises, stays and places rather than a delta threaded into
 * each tab's own tiles: those tiles were built three different ways, and a
 * comparison drawn three ways is three chances to disagree about what "up"
 * means. The flight tab keeps its own four tiles, which already compared.
 *
 * Only counts go in. A money figure needs to say which currency and how much
 * went unpriced, and a percentage of a currency mix is not a trend.
 *
 * These rows are per-year totals the SERVER computed, so — unlike the Gesamt
 * tab, which folds day-keyed adapters and can cut them at today — this strip
 * cannot narrow a still-running year to the same span of the compare year.
 * What it can do is stop presenting the comparison as like-for-like: it asks
 * the same `comparisonWindow` whether the year is over and says "vs. the whole
 * of 2025" rather than "vs 2025" when it is not, with the reason underneath.
 * Narrowing the numbers themselves needs the endpoints to accept a date range.
 */
export default function PeriodComparisonStrip({
  year,
  compareYear,
  rows,
  evidence,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation(["stats"]);
  const grouped = new Intl.NumberFormat(i18n.language.startsWith("de") ? "de-DE" : "en-GB");
  // Both years, because the compare year can be the LATER one: 2025 against
  // 2026 is a full year set against eight months, sides swapped.
  const running = comparisonWindow(year, compareYear).runningYear;
  return (
    <section aria-label={t("stats:yearFilter.scopeLabel", { year })}>
      <div
        className="flex items-baseline gap-3 mb-3"
        style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: 8 }}
      >
        <span
          className="text-xs uppercase tracking-widest font-semibold"
          style={{ color: "var(--accent)" }}
        >
          {t("stats:yearFilter.scopeLabel", { year })}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t(running !== null ? "stats:yearFilter.vsFullYear" : "stats:yearFilter.vs", {
            year: compareYear,
          })}
        </span>
      </div>
      {running !== null && (
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          {t("stats:yearFilter.partialYearNote", { year: running })}
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {rows.map((row) => {
          const format = row.format ?? ((n: number): string => grouped.format(n));
          const figureClass = "text-2xl font-bold font-mono";
          const figureStyle = { color: "var(--text-primary)" };
          return (
            <div
              key={row.key}
              className="rounded-lg p-4"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
            >
              <h3 className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                {row.label}
              </h3>
              <div className="mt-1 flex flex-wrap items-end gap-2">
                {evidence && row.evidenceKey ? (
                  // Tailwind's preflight zeroes a button's border and
                  // background, so the figure keeps its look and gains a
                  // keyboard-operable trigger. `width: auto` undoes
                  // `EvidenceTrigger`'s own 100 % reset, which would push the
                  // delta beside it onto the next line.
                  <EvidenceTrigger
                    kind="metric"
                    evidenceKey={row.evidenceKey}
                    scope={evidence.scope}
                    renderedValue={row.current}
                    label={row.label}
                    className={figureClass}
                    style={{ ...figureStyle, display: "inline-block", width: "auto" }}
                  >
                    {format(row.current)}
                  </EvidenceTrigger>
                ) : (
                  <p className={figureClass} style={figureStyle}>
                    {format(row.current)}
                  </p>
                )}
                <TrendDelta current={row.current} previous={row.previous} />
              </div>
              <p className="text-xs mt-1 font-mono" style={{ color: "var(--text-muted)" }}>
                {format(row.previous)} ({compareYear})
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
