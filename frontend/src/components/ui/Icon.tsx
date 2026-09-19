import { createElement } from "react";
import type { CSSProperties, JSX } from "react";
import { LUCIDE, type IconName } from "./icons/lucide";

interface IconProps {
  name: IconName;
  /**
   * 18 is the standard, 16 inside a row, 14 inside a chip (design round 4,
   * E16). A number rather than a free CSS length, so the three sizes stay
   * three sizes.
   */
  size?: 14 | 16 | 18 | 20 | 24;
  /** A label makes the icon speak; without one it is decoration. */
  label?: string;
  style?: CSSProperties;
  className?: string;
}

/** One Lucide icon, stroked in the current text colour. */
export function Icon({ name, size = 18, label, style, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={{ flexShrink: 0, ...style }}
      className={className}
    >
      {LUCIDE[name].map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }))}
    </svg>
  );
}

export type { IconName };
