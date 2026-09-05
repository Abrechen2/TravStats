import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  /** Required: an icon alone tells a screen reader nothing. */
  label: string;
}

/**
 * 44×44, radius 14, `surface2`, one hairline.
 *
 * The size is not a style choice — 44 is the minimum hit area for every
 * pointer target, and an icon button is the shape most likely to fall below it
 * when someone sizes it to the glyph instead of to the finger.
 */
export default function IconButton({
  children,
  label,
  style,
  className,
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`ts-icon-button ${className ?? ""}`.trim()}
      style={{
        width: "var(--ts-size-touch-min)",
        height: "var(--ts-size-touch-min)",
        borderRadius: "var(--ts-radius-tile)",
        background: "var(--ts-surface2)",
        border: "1px solid var(--ts-border)",
        color: "var(--ts-text)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "background var(--ts-motion-fast) var(--ts-ease-standard)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
