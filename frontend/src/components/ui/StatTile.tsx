import type { ReactNode } from "react";

interface SectionLabelProps {
  children: ReactNode;
}

/**
 * The one section heading inside a page: mono, 11px, uppercase, 0.12em.
 *
 * Mono here is not decoration — a section label is a signpost, not prose, and
 * the mono face is what separates the two everywhere else in the system too.
 */
export function SectionLabel({ children }: SectionLabelProps): JSX.Element {
  return <div className="t-label-mono">{children}</div>;
}

interface StatTileProps {
  /** The number. Rendered tabular so a column of them lines up. */
  value: ReactNode;
  label: ReactNode;
  /** A unit or a qualifier next to the number, in the UI face, not mono. */
  suffix?: ReactNode;
  /**
   * Present ONLY when the tile leads somewhere. A chevron is a promise; a tile
   * without one is deliberately a statement.
   */
  onClick?: () => void;
  href?: string;
}

/**
 * A number and what it counts.
 *
 * 28px is the tile size for `statNumber` (the token's 20 is the inline size, in
 * a row of facts). The label is muted and sits under the number, never beside
 * it — a label to the left of a big number gets read as part of the number.
 */
export default function StatTile({
  value,
  label,
  suffix,
  onClick,
  href,
}: StatTileProps): JSX.Element {
  const leadsSomewhere = Boolean(onClick || href);
  const body = (
    <>
      <div className="flex items-baseline" style={{ gap: "var(--ts-space-xs)" }}>
        <span className="t-stat-number" style={{ fontSize: 28, lineHeight: 1.1 }}>
          {value}
        </span>
        {suffix ? <span style={{ fontSize: 14, color: "var(--ts-muted)" }}>{suffix}</span> : null}
      </div>
      <div className="t-caption">{label}</div>
    </>
  );

  const style = {
    background: "var(--ts-tile)",
    border: "1px solid var(--ts-border)",
    borderRadius: "var(--ts-radius-tile)",
    padding: "var(--ts-space-lg)",
    display: "flex",
    flexDirection: "column" as const,
    gap: "var(--ts-space-xs)",
    minWidth: 0,
    textAlign: "left" as const,
  };

  if (href) {
    return (
      <a href={href} className="ts-stat-tile" style={{ ...style, textDecoration: "none" }}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="ts-stat-tile" style={style}>
        {body}
      </button>
    );
  }
  return (
    <div style={style} data-leads={leadsSomewhere ? "yes" : "no"}>
      {body}
    </div>
  );
}
