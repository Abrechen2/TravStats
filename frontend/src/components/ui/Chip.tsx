import type { ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** A count or measure, rendered in mono because that is what it is. */
  meta?: string;
  title?: string;
}

/**
 * A filter chip. Active is an amber fill, and there is at most ONE chip row
 * before a list — the moment there are two, the second one is a filter panel
 * pretending to be chrome.
 *
 * A chip is not a pill: a pill states a fact about a row, a chip changes what
 * the list shows. They look different on purpose (fill versus tint, sentence
 * case versus capitals) so a reader never tries to click a status.
 */
export default function Chip({
  children,
  active = false,
  onClick,
  meta,
  title,
}: ChipProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={onClick ? active : undefined}
      className="ts-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--ts-space-sm)",
        // Below the 44 minimum on purpose: a chip row is dense, and the row
        // itself gives the finger its target through vertical padding.
        height: 34,
        padding: "0 var(--ts-space-lg)",
        borderRadius: "var(--ts-radius-chip)",
        background: active ? "var(--ts-accent)" : "transparent",
        color: active ? "var(--ts-accent-text)" : "var(--ts-text)",
        border: `1px solid ${active ? "var(--ts-accent)" : "var(--ts-border-button)"}`,
        fontFamily: "var(--ts-font-ui)",
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        transition: "background var(--ts-motion-fast) var(--ts-ease-standard)",
      }}
    >
      {children}
      {meta ? (
        <span
          style={{
            fontFamily: "var(--ts-font-mono)",
            fontSize: 11,
            opacity: active ? 0.7 : 1,
            color: active ? "var(--ts-accent-text)" : "var(--ts-muted)",
          }}
        >
          {meta}
        </span>
      ) : null}
    </button>
  );
}
