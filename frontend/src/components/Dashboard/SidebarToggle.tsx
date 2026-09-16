import type { JSX } from "react";
import { Icon } from "../ui/Icon";

/**
 * The button over the map that opens a tab's list sidebar.
 *
 * Six dashboard tabs each drew their own copy — the same absolute position,
 * the same `rgba(22,27,34,0.85)` backdrop and a "☰" glyph in front of the
 * label — and two of them had already drifted to a different font size.
 * Round 4 draws it as a surface chip with a line icon; one component keeps
 * the six from drifting again. It moves right while the 320px panel is open
 * so the two never overlap.
 */
export function SidebarToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex items-center gap-2 whitespace-nowrap"
      style={{
        position: "absolute",
        top: 12,
        left: open ? 340 : 12,
        zIndex: 30,
        padding: "7px 14px",
        borderRadius: 999,
        background: "color-mix(in srgb, var(--ts-surface) 92%, transparent)",
        color: "var(--ts-text-bright)",
        border: "1px solid var(--ts-border)",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
        transition: "left 0.2s ease",
      }}
    >
      <Icon name="activity" size={16} />
      {label}
    </button>
  );
}
