import type { JSX } from "react";

/**
 * A few numbers about the rows you can currently see.
 *
 * The lodging list already carried a stat strip and the other two carried
 * nothing — but simply copying that one across would have tripled a trap
 * rather than fixing an asymmetry. `LodgingStatStrip` renders the backend's
 * own rollup over the WHOLE library, deliberately and for a good reason (it
 * cannot drift from `/stats/lodging`). Above a filtered table it therefore
 * contradicts the table: total spend for 60 hotels, over seven rows, next to
 * a filter-aware "7 angezeigt" in the bar.
 *
 * So this is a different thing with a different promise, and the promise is in
 * the name: it summarises the LIST, and it is computed from exactly the rows
 * the list is showing. The authoritative totals keep their home in the
 * dashboard, where nothing is filtered underneath them.
 *
 * Kept to a handful of figures that read straight off a row. Anything
 * estimated — flight time and distance are both derived, and the app is
 * careful to mark them as estimates wherever they appear — has no business
 * being silently summed into a headline number.
 */

export interface SummaryFigure {
  key: string;
  value: string;
  label: string;
}

interface Props {
  figures: readonly SummaryFigure[];
  /** True when a filter is narrowing the list, which changes what these mean. */
  filtered: boolean;
  /** "gefiltert" — shown only while that is true. */
  filteredLabel: string;
}

export default function ListSummaryStrip({
  figures,
  filtered,
  filteredLabel,
}: Props): JSX.Element | null {
  if (figures.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-end gap-x-8 gap-y-3">
      {figures.map((f) => (
        <div key={f.key} className="flex flex-col">
          <span
            className="text-2xl font-semibold leading-none"
            style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
          >
            {f.value}
          </span>
          <span
            className="mt-1 text-[11px] uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {f.label}
          </span>
        </div>
      ))}
      {filtered && (
        <span
          data-testid="list-summary-filtered"
          className="mb-1 rounded-full border px-2 py-0.5 text-[11px]"
          style={{ borderColor: "var(--color-border)", color: "var(--text-muted)" }}
        >
          {filteredLabel}
        </span>
      )}
    </div>
  );
}
