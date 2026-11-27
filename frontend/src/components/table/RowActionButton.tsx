import { Icon, type IconName } from "../ui/Icon";
import type { JSX, MouseEvent, ReactNode } from "react";

/**
 * The icon buttons at the end of a list row, shared by every domain list.
 *
 * Each table used to bring its own: flights drew SVG icons, cruises used
 * tinted text buttons that ate half a column, and lodging had no actions at
 * all. Writing the icons a third time for lodging would have repeated exactly
 * the copying this change exists to undo.
 *
 * Every handler stops propagation, because the rows themselves navigate now —
 * without it, clicking "delete" would also open the entry underneath.
 */

export type RowActionIcon = "edit" | "duplicate" | "delete" | "checkIn" | "link" | "unlink";

const ICON_OF: Record<RowActionIcon, IconName> = {
  edit: "pencil",
  duplicate: "copy",
  // A pin with a tick: "I was here" — record a visit (places, forgejo#231).
  checkIn: "map-pin-check",
  // A chain: assign to / detach from a trip (tours list).
  link: "link",
  unlink: "unlink",
  delete: "trash-2",
};

/** Hover colour per action: blue for edit, neutral for duplicate, red for delete. */
const HOVER_CLASS: Record<RowActionIcon, string> = {
  edit: "hover:bg-(--bg-muted) hover:text-[#388bfd]",
  duplicate: "hover:bg-(--bg-muted) hover:text-(--text-primary)",
  delete: "hover:bg-(--bg-muted) hover:text-(--danger)",
  checkIn: "hover:bg-(--bg-muted) hover:text-(--domain-poi)",
  link: "hover:bg-(--bg-muted) hover:text-(--text-primary)",
  unlink: "hover:bg-(--bg-muted) hover:text-(--text-primary)",
};

/**
 * Touch target without a layout change (forgejo#249). On a coarse pointer the
 * button keeps its 28 px box - the action columns are fixed-width, and growing
 * the button itself overflowed them - and an `::after` extends the HIT area by
 * 8 px on every side to 44 px (`--ts-size-touch-min`). The 8 px is exactly the
 * `gap-2` between neighbours, so the extension fills the gap and reaches no
 * other button's drawn box.
 */
export const TOUCH_HIT_AREA = "pointer-coarse:after:absolute pointer-coarse:after:-inset-2";

interface Props {
  icon: RowActionIcon;
  /** Used for both the accessible name and the tooltip — an icon with neither
   *  is a guess for anyone who does not already know the app. */
  label: string;
  onClick: () => void;
  testId?: string;
  /**
   * `compact` (default) is the 28 px box of a table's fixed action column,
   * grown to 44 px of HIT area on a coarse pointer only. `touch` draws the
   * 44 px box itself, for a row with room for it (a place's visit list).
   */
  size?: "compact" | "touch";
}

export function RowActionButton({
  icon,
  label,
  onClick,
  testId,
  size = "compact",
}: Props): JSX.Element {
  const box = size === "touch" ? "h-11 w-11 rounded-md" : `h-7 w-7 rounded-sm ${TOUCH_HIT_AREA}`;
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      }}
      className={`relative inline-flex items-center justify-center ${box} ${HOVER_CLASS[icon]}`}
      style={{ color: "var(--text-muted)" }}
      aria-label={label}
      title={label}
    >
      <Icon name={ICON_OF[icon]} size={16} />
    </button>
  );
}

/** The row-actions cell wrapper, so every list aligns them the same way. */
export function RowActions({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex items-center justify-end gap-2">{children}</div>;
}
