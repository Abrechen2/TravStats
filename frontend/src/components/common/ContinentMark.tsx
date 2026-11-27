import type { JSX, ReactNode } from "react";
import { Icon } from "../ui/Icon";

/**
 * A continent name with a small globe in front. The icon is decoration: the
 * name is the accessible text, so a screen reader hears it once.
 */
export function ContinentMark({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--text-muted)" }}>
        <Icon name="globe" size={14} />
      </span>
      {children}
    </span>
  );
}
