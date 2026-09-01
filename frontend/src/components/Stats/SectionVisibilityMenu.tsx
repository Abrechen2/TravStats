import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { SectionVisibility } from "../../hooks/useSectionVisibility";

export interface SectionOption {
  key: string;
  label: string;
}

interface Props {
  options: SectionOption[];
  visibility: SectionVisibility;
}

/**
 * The control that hides parts of a statistics tab.
 *
 * A menu rather than a row of chips: the flight tab has a dozen blocks, and
 * twelve toggles across the top would be a bigger thing to read past than the
 * section somebody wanted to hide.
 *
 * The count of hidden blocks sits on the button. A page silently missing a
 * section is confusing in a way that is very hard to trace back — six months
 * later nobody remembers switching costs off, and the block simply "does not
 * exist" in this app.
 */
export default function SectionVisibilityMenu({ options, visibility }: Props): JSX.Element {
  const { t } = useTranslation(["stats", "common"]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on an outside click and on Escape — a menu that can only be closed by
  // the button that opened it is a menu people leave open by accident.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return (): void => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--text-secondary)",
          background: "var(--bg-surface)",
        }}
      >
        {t("stats:sections.button")}
        {visibility.hiddenCount > 0 && (
          <span
            className="rounded-full px-1.5 text-xs"
            style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
          >
            {t("stats:sections.hiddenCount", { count: visibility.hiddenCount })}
          </span>
        )}
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 z-40 mt-2 w-64 rounded-lg border p-2 shadow-lg"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--color-border)" }}
        >
          <ul className="max-h-80 overflow-y-auto">
            {options.map((option) => (
              <li key={option.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--bg-surface)]">
                  <input
                    type="checkbox"
                    checked={visibility.isVisible(option.key)}
                    onChange={() => visibility.toggle(option.key)}
                  />
                  <span style={{ color: "var(--text-primary)" }}>{option.label}</span>
                </label>
              </li>
            ))}
          </ul>
          {visibility.hiddenCount > 0 && (
            <button
              type="button"
              onClick={visibility.reset}
              className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-surface)]"
              style={{ color: "var(--text-muted)" }}
            >
              {t("stats:sections.showAll")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
