import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";

export interface MetricHelpItem {
  /** The figure the line explains, as it is titled on screen. */
  term: string;
  /** Counting unit, time rule, source, coverage and what stays out — in one or two sentences. */
  text: string;
}

/**
 * "So wird gezählt" under a block of statistics (forgejo#261–#265): every
 * figure in the block names its counting unit, the calendar it is filed on,
 * where it comes from, how much of the data carries it and what is left out.
 *
 * A native `<details>`/`<summary>` rather than a hover tooltip: the summary
 * is focusable and opens with Enter or Space, a tap opens it on a tablet
 * (the web build is drawn for iPads — owner, 2026-09-28), and a screen reader
 * announces it as a disclosure. A tooltip offers none of the three.
 */
export default function MetricHelp({
  items,
  testId,
}: {
  items: readonly MetricHelpItem[];
  testId?: string;
}): JSX.Element | null {
  const { t } = useTranslation(["stats"]);
  if (items.length === 0) return null;
  return (
    <details className="mt-3 text-sm" data-testid={testId}>
      <summary
        className="cursor-pointer select-none underline-offset-2 hover:underline"
        style={{ color: "var(--text-muted)" }}
      >
        {t("stats:metricHelp.summary")}
      </summary>
      <dl className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={item.term}>
            <dt className="font-medium" style={{ color: "var(--text-primary)" }}>
              {item.term}
            </dt>
            <dd style={{ color: "var(--text-muted)" }}>{item.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
