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
  /**
   * What this figure is silent about, when it is silent about something.
   *
   * The airline count is the case that asked for it: the list derives a
   * carrier from the flight number for the logo, so a row can show a
   * Lufthansa tile while the count — which counts RECORDED airlines, the one
   * rule in `shared/airlineNormalize.ts` — does not include it. Both are
   * right, and side by side without a word they read as a contradiction.
   * `/stats` already answers this by reporting `withoutAirline` next to the
   * ranking "so the ranking can say what it is silent about"; this is the
   * same sentence one surface further.
   */
  note?: string;
}

interface Props {
  figures: readonly SummaryFigure[];
  /** True when a filter is narrowing the list, which changes what these mean. */
  filtered: boolean;
  /** "gefiltert" — shown only while that is true. */
  filteredLabel: string;
  /**
   * True while the list has nothing trustworthy to summarise — still loading,
   * or the load failed. Then the strip renders NOTHING.
   *
   * Found in UAT: with the API unreachable, the cruise list showed
   * "0 Kreuzfahrten · 0 Hafenanläufe · 0 Seetage · 0 Reedereien" directly above
   * "Die Kreuzfahrten konnten nicht geladen werden." Four zeros read as facts
   * about an empty logbook, sitting on top of a sentence saying we do not know
   * — the same contradiction this page spent the day removing from the empty
   * state, reintroduced one element higher up.
   */
  unknown?: boolean;
}

export default function ListSummaryStrip({
  figures,
  filtered,
  filteredLabel,
  unknown = false,
}: Props): JSX.Element | null {
  if (unknown || figures.length === 0) return null;

  // One mono line under the title — "123 Flüge · 5 Airlines · 30 Flughäfen" —
  // as round 4 draws it. The figures used to stand as 24px numbers between
  // the title and the table, pushing the first row down.
  return (
    <p
      className="t-caption -mt-2 mb-4 flex flex-wrap items-center"
      style={{ fontFamily: "var(--ts-font-mono)", gap: "4px 8px" }}
    >
      {figures.map((f, index) => (
        <span key={f.key} className="whitespace-nowrap">
          {index > 0 && <span aria-hidden="true">· </span>}
          <span style={{ color: "var(--ts-text)", fontVariantNumeric: "tabular-nums" }}>
            {f.value}
          </span>{" "}
          {f.label}
          {/* The qualifier rides WITH the figure, not beside the strip: an
              airline count that quietly omits the flights whose carrier was
              never recorded is a different number than it looks, and the
              reader has to see that where they read the number. */}
          {f.note && <span style={{ opacity: 0.8 }}> {f.note}</span>}
        </span>
      ))}
      {filtered && (
        <span
          data-testid="list-summary-filtered"
          className="rounded-full border px-2 py-0.5 text-[11px]"
          style={{
            borderColor: "var(--ts-border)",
            color: "var(--ts-muted)",
            fontFamily: "var(--ts-font-ui)",
          }}
        >
          {filteredLabel}
        </span>
      )}
    </p>
  );
}
