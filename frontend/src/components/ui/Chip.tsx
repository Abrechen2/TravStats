import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { Icon, type IconName } from "./Icon";
import type { CSSProperties, JSX, ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  active?: boolean;
  /** Present: the chip is a button that changes what a list shows or adds a value. */
  onClick?: () => void;
  /**
   * Present: the chip carries a value the reader can take away (a tag, a
   * companion). Draws a remove button beside the label, a real button with its
   * own name, so the chip itself is not an interactive element nested in another.
   */
  onRemove?: () => void;
  /** Names the remove button: "Tag Urlaub entfernen". */
  removeLabel?: string;
  /** For tests: the remove button of one chip among several that share a name. */
  removeTestId?: string;
  /** A count or measure, rendered in mono because that is what it is. */
  meta?: string;
  /** On a clickable chip only: a read-only chip carries no title (help lives in a Toggletip). */
  title?: string;
  /** The spoken name, when the visible text is not enough ("Tag Urlaub: hinzufügen"). */
  ariaLabel?: string;
  icon?: IconName;
  /**
   * Dashed outline: "add this" (a suggestion that is not yet a value), as
   * against a solid chip that already is one.
   */
  dashed?: boolean;
  /**
   * A colour that belongs to the data (a trip's, a domain's): tints the chip
   * with it instead of the accent. A CSS colour or a token reference.
   */
  color?: string;
  /** `sm` for a chip inside a row of text, `md` for a filter row. */
  size?: "sm" | "md";
  disabled?: boolean;
  testId?: string;
  className?: string;
}

/**
 * A chip: a filter, a tag, a suggestion, a person on a trip. Active is an
 * amber fill, and there is at most ONE filter-chip row before a list — the
 * moment there are two, the second one is a filter panel pretending to be
 * chrome.
 *
 * A chip is not a pill: a pill states a fact about a row, a chip changes what
 * the list shows or carries a value you can take away. They look different on
 * purpose (fill versus tint, sentence case versus capitals) so a reader never
 * tries to click a status. With neither `onClick` nor `onRemove` a chip is
 * plain text in a frame (a read-only tag).
 */
export default function Chip({
  children,
  active = false,
  onClick,
  onRemove,
  removeLabel,
  removeTestId,
  meta,
  title,
  ariaLabel,
  icon,
  dashed = false,
  color,
  size = "md",
  disabled = false,
  testId,
  className,
}: ChipProps): JSX.Element {
  const coarse = useCoarsePointer();
  const interactive = onClick !== undefined;
  const small = size === "sm";
  const tint = color ?? "var(--ts-accent)";
  const filled = active && color === undefined;

  const frame: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--ts-space-sm)",
    // Below the 44 minimum on purpose: a chip row is dense, and the row
    // itself gives the finger its target through vertical padding. On a
    // finger the interactive ones take the full target.
    height: coarse && interactive ? undefined : small ? 24 : 34,
    minHeight: coarse && interactive ? "var(--ts-size-touch-min)" : undefined,
    padding: small ? "0 var(--ts-space-md)" : "0 var(--ts-space-lg)",
    borderRadius: "var(--ts-radius-chip)",
    background: filled
      ? "var(--ts-accent)"
      : color !== undefined
        ? `color-mix(in srgb, ${tint} ${active ? 28 : 16}%, transparent)`
        : "transparent",
    color: filled
      ? "var(--ts-accent-text)"
      : color !== undefined
        ? "var(--ts-text)"
        : "var(--ts-text)",
    border: `1px ${dashed ? "dashed" : "solid"} ${
      filled || color !== undefined ? tint : "var(--ts-border-button)"
    }`,
    fontFamily: "var(--ts-font-ui)",
    fontSize: small ? 12 : 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
    opacity: disabled ? 0.5 : 1,
    transition: "background var(--ts-motion-fast) var(--ts-ease-standard)",
  };

  const body = (
    <>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
      {meta ? (
        <span
          style={{
            fontFamily: "var(--ts-font-mono)",
            fontSize: 11,
            opacity: active ? 0.7 : 1,
            color: filled ? "var(--ts-accent-text)" : "var(--ts-muted)",
          }}
        >
          {meta}
        </span>
      ) : null}
    </>
  );

  const remove =
    onRemove !== undefined ? (
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        data-testid={removeTestId}
        disabled={disabled}
        className="flex items-center justify-center"
        style={{
          minWidth: coarse ? "var(--ts-size-touch-min)" : 20,
          minHeight: coarse ? "var(--ts-size-touch-min)" : 20,
          margin: coarse ? "0 -12px 0 -6px" : "0 -6px 0 -2px",
          color: "var(--ts-muted)",
        }}
      >
        <Icon name="x" size={14} />
      </button>
    ) : null;

  if (!interactive) {
    return (
      <span
        className={`ts-chip-static${className ? ` ${className}` : ""}`}
        aria-label={ariaLabel}
        data-testid={testId}
        style={frame}
      >
        {body}
        {remove}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center" style={{ gap: 0 }}>
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={ariaLabel}
        disabled={disabled}
        data-testid={testId}
        aria-pressed={dashed ? undefined : active}
        className={`ts-chip pointer-coarse:min-h-(--ts-size-touch-min)${className ? ` ${className}` : ""}`}
        style={frame}
      >
        {body}
      </button>
      {remove}
    </span>
  );
}
