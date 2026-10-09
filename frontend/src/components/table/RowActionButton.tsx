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

export type RowActionIcon = "edit" | "duplicate" | "delete" | "checkIn";

const PATHS: Record<RowActionIcon, ReactNode> = {
  edit: <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  duplicate: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  // A pin with a tick: "I was here" — record a visit (places, forgejo#231).
  checkIn: (
    <>
      <path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" />
      <path d="m9 10 2 2 4-4" />
    </>
  ),
  delete: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </>
  ),
};

/** Hover colour per action: blue for edit, neutral for duplicate, red for delete. */
const HOVER_CLASS: Record<RowActionIcon, string> = {
  edit: "hover:bg-(--bg-muted) hover:text-[#388bfd]",
  duplicate: "hover:bg-(--bg-muted) hover:text-(--text-primary)",
  delete: "hover:bg-(--bg-muted) hover:text-(--danger)",
  checkIn: "hover:bg-(--bg-muted) hover:text-(--domain-poi)",
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
}

export function RowActionButton({ icon, label, onClick, testId }: Props): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      }}
      className={`relative inline-flex h-7 w-7 items-center justify-center rounded-sm ${TOUCH_HIT_AREA} ${HOVER_CLASS[icon]}`}
      style={{ color: "var(--text-muted)" }}
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {PATHS[icon]}
      </svg>
    </button>
  );
}

/** The row-actions cell wrapper, so every list aligns them the same way. */
export function RowActions({ children }: { children: ReactNode }): JSX.Element {
  return <div className="flex items-center justify-end gap-2">{children}</div>;
}
