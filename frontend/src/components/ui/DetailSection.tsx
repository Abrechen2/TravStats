import type { JSX, ReactNode } from "react";

export interface DetailFact {
  label: string;
  value: ReactNode;
  /** Codes and measurements, set in the mono face. */
  mono?: boolean;
}

interface DetailSectionProps {
  title: string;
  /** Right-aligned on the title's line: a status word, a short note. */
  aside?: ReactNode;
  /** The labelled values. Empty values are left out; with none, nothing is drawn. */
  facts?: readonly DetailFact[];
  /** Free content instead of (or after) the facts — a link, a list, notes. */
  children?: ReactNode;
  /** Content above the facts — a map the values below describe. */
  lead?: ReactNode;
  /** Grid columns from `sm` up; a sidebar section reads better with two. */
  columns?: 2 | 3;
}

const isEmpty = (value: ReactNode): boolean =>
  value === null || value === undefined || value === "" || value === false;

/**
 * One section of a detail page, round 4 (decision E6).
 *
 * The title stands above the card as a mono label, the card holds the values
 * as a three-column grid with the label over the value — the same shape the
 * settings cards have. The detail pages used to draw a bold heading inside
 * each card and a "label … value" row with the value pushed to the far right,
 * so a reader's eye crossed the card for every field.
 *
 * A section with nothing to say renders nothing: an empty card is a question
 * the reader has to answer ("is this missing, or broken?").
 */
export default function DetailSection({
  title,
  aside,
  facts = [],
  children,
  lead,
  columns = 3,
}: DetailSectionProps): JSX.Element | null {
  const filled = facts.filter((fact) => !isEmpty(fact.value));
  if (filled.length === 0 && isEmpty(children) && isEmpty(lead)) return null;

  return (
    <section className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <div className="flex items-baseline justify-between" style={{ gap: "var(--ts-space-md)" }}>
        <h2 className="t-label-mono">{title}</h2>
        {aside ? <span className="t-caption">{aside}</span> : null}
      </div>
      <div
        className="flex flex-col"
        style={{
          gap: "var(--ts-space-lg)",
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
          padding: "var(--ts-space-lg) var(--ts-space-xl)",
        }}
      >
        {lead}
        {filled.length > 0 && (
          <dl
            className={`grid grid-cols-2 ${columns === 3 ? "sm:grid-cols-3" : ""}`}
            style={{ gap: "var(--ts-space-lg) var(--ts-space-xl)" }}
          >
            {filled.map((fact) => (
              <div key={fact.label} className="flex min-w-0 flex-col" style={{ gap: 2 }}>
                <dt className="t-caption">{fact.label}</dt>
                <dd
                  className="break-words"
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--ts-text-bright)",
                    fontFamily: fact.mono ? "var(--ts-font-mono)" : undefined,
                  }}
                >
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </div>
    </section>
  );
}
