import type { JSX } from "react";

import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import { useTranslation } from "../../../hooks/useTranslation";
import { COUNTING_FIELDS, type CountingEntry } from "./countingEntry";

/**
 * "So wird gezählt" under a figure or a block of figures — the ONE way the
 * statistics tabs explain how a number came about (forgejo#256–#265). Each
 * entry names its figure (when there are several) and answers the five questions of `COUNTING_FIELDS`;
 * the jump to the entries behind a number is the number's own evidence
 * trigger, not part of this text.
 *
 * A native `<details>`/`<summary>` rather than a hover tooltip: the summary is
 * focusable and opens with Enter or Space, a tap opens it on a tablet (the web
 * build is drawn for iPads — owner, 2026-09-28), and a screen reader announces
 * it as a disclosure. Focus is drawn by the system `:focus-visible` outline
 * (forgejo#249), which nothing here removes; under a finger the summary grows
 * to a 44 px target (`useCoarsePointer`), since its text line alone is ~20 px.
 */
export default function CountingHelp({
  entries,
  testId,
}: {
  entries: readonly CountingEntry[];
  testId?: string;
}): JSX.Element | null {
  const { t } = useTranslation(["stats"]);
  const coarse = useCoarsePointer();
  if (entries.length === 0) return null;
  // One figure: the help sits under it, so its name would only repeat the
  // title above (and read twice). Several: each answer set needs its name.
  const named = entries.length > 1;
  const target = coarse ? "inline-flex min-h-11 items-center" : "";
  return (
    <details className="mt-3 text-sm" data-testid={testId}>
      <summary
        className={`cursor-pointer select-none underline-offset-2 hover:underline ${target}`}
        style={{ color: "var(--text-muted)" }}
      >
        {t("stats:counting.summary")}
      </summary>
      <div className="mt-2 space-y-3">
        {entries.map((entry) => (
          <section key={entry.helpKey} aria-label={entry.term}>
            {named && (
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                {entry.term}
              </p>
            )}
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {COUNTING_FIELDS.map((field) => (
                <div key={field} className="contents">
                  <dt className="font-medium" style={{ color: "var(--text-muted)" }}>
                    {t(`stats:counting.fields.${field}`)}
                  </dt>
                  <dd style={{ color: "var(--text-primary)" }}>
                    {t(`${entry.helpKey}.${field}`, entry.values)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </details>
  );
}
