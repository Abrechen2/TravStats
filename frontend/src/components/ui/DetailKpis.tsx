import type { JSX, ReactNode } from "react";

export interface DetailKpi {
  /** Stable key; the label may repeat across locales. */
  key: string;
  value: ReactNode;
  label: ReactNode;
}

/**
 * The figures strip under a detail head — round 4's cruise and stay pages:
 * a large mono number with a short caption, laid out in an even row.
 *
 * Only figures the entry really carries are passed in; a figure that cannot
 * be derived is left out rather than drawn as a zero.
 */
export default function DetailKpis({ items }: { items: readonly DetailKpi[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <dl
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
      style={{ gap: "var(--ts-space-lg) var(--ts-space-xl)" }}
    >
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 flex-col-reverse" style={{ gap: 2 }}>
          {/* dt first for a valid <dl>; flex-col-reverse puts the number on top. */}
          <dt className="t-caption">{item.label}</dt>
          <dd
            style={{
              fontFamily: "var(--ts-font-mono)",
              fontSize: 22,
              fontWeight: 700,
              lineHeight: 1.1,
              color: "var(--ts-text-bright)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
