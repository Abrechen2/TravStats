// The right-click menu of the route editor.
//
// Owner's instruction: everything by mouse, right-click included. The editor's
// commands used to live only in a toolbar (undo, redo, save) or only on the
// keyboard (delete a waypoint), which meant the two things a user does most —
// pick a different leg, drop a handful of handles — had no mouse route at all.
//
// It is `position: fixed` and mounted where it is rendered rather than in a
// portal: the editor is a full-screen dialog, so there is no clipping ancestor
// to escape, and a portal would put it outside the dialog for a screen reader.

import { useEffect, useRef, type JSX } from "react";

export interface MapMenuEntry {
  /** `null` renders a separator; everything else is a command. */
  label: string | null;
  onSelect?: () => void;
  disabled?: boolean;
}

export interface MapContextMenuProps {
  /** Viewport coordinates of the click, as `clientX`/`clientY` give them. */
  x: number;
  y: number;
  title: string;
  entries: MapMenuEntry[];
  onClose: () => void;
}

/** Keeps the menu inside the window when the click was near an edge. */
function clamp(value: number, size: number, limit: number): number {
  return Math.max(8, Math.min(value, limit - size - 8));
}

export function MapContextMenu({ x, y, title, entries, onClose }: MapContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on anything that is not this menu: a click elsewhere, Escape, or the
  // map moving under it. A menu that outlives its context is a menu that acts
  // on the wrong thing.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        // The editor also closes on Escape. Stopping it here means the first
        // Escape dismisses the menu and the second leaves the editor, rather
        // than one keystroke doing both.
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = `${clamp(x, el.offsetWidth, window.innerWidth)}px`;
    el.style.top = `${clamp(y, el.offsetHeight, window.innerHeight)}px`;
    el.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      data-testid="map-context-menu"
      className="fixed z-[60] min-w-52 rounded-lg border border-border bg-(--bg-surface) p-1 shadow-2xl"
      style={{ left: x, top: y }}
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[10px] uppercase tracking-wider text-(--text-muted)">
        {title}
      </div>
      {entries.map((entry, index) =>
        entry.label === null ? (
          <div key={`sep-${index}`} className="my-1 h-px bg-(--color-border)" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect?.();
            }}
            className="block w-full rounded px-2.5 py-1.5 text-left text-sm text-(--text-primary) hover:bg-white/5 disabled:opacity-40"
          >
            {entry.label}
          </button>
        )
      )}
    </div>
  );
}
