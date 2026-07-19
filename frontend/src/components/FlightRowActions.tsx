/**
 * Edit / Duplicate / Delete button cluster rendered on each flight row
 * in FlightsTablePage. Extracted from the page component so it stays
 * under CLAUDE.md's 800-line hard maximum.
 *
 * The dropdown is controlled — the page owns `openDuplicateMenuFor`
 * and toggles it from the outside-click listener + the toggle button.
 */
import type { Flight } from "../types";
import { useTranslation } from "../hooks/useTranslation";

interface Props {
  flight: Flight;
  openDuplicateMenuFor: string | null;
  onToggleDuplicateMenu: (id: string | null) => void;
  onEdit: (flight: Flight) => void;
  onDuplicate: (flight: Flight, mode: "return" | "same") => void;
  onDelete: (id: string) => void;
}

export default function FlightRowActions({
  flight,
  openDuplicateMenuFor,
  onToggleDuplicateMenu,
  onEdit,
  onDuplicate,
  onDelete,
}: Props): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  const menuOpen = openDuplicateMenuFor === flight.id;

  return (
    <div className="flex items-center justify-end gap-2">
      {/* Edit button */}
      <button
        onClick={() => onEdit(flight)}
        className="inline-flex items-center justify-center w-7 h-7 rounded-sm hover:bg-(--bg-muted) hover:text-[#388bfd]"
        style={{ color: "var(--text-muted)" }}
        aria-label={t("common:buttons.edit")}
        title={t("common:buttons.edit")}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </button>

      {/* Duplicate button with dropdown */}
      <div className="relative" data-duplicate-menu>
        <button
          onClick={() => onToggleDuplicateMenu(menuOpen ? null : flight.id)}
          className="inline-flex items-center justify-center w-7 h-7 rounded-sm hover:bg-(--bg-muted) hover:text-(--text-primary)"
          style={{ color: "var(--text-muted)" }}
          aria-label={t("flights:table.duplicate.label")}
          title={t("flights:table.duplicate.label")}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 mt-1 rounded-sm shadow-lg z-20 min-w-[180px]"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <button
              onClick={() => onDuplicate(flight, "same")}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-(--bg-elevated)"
              style={{ color: "var(--text-primary)" }}
            >
              {t("flights:table.duplicate.same")}
            </button>
            <button
              onClick={() => onDuplicate(flight, "return")}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-(--bg-elevated)"
              style={{ color: "var(--text-primary)" }}
            >
              {t("flights:table.duplicate.return")}
            </button>
          </div>
        )}
      </div>

      {/* Delete button */}
      <button
        onClick={() => onDelete(flight.id)}
        className="inline-flex items-center justify-center w-7 h-7 rounded-sm hover:bg-(--bg-muted) hover:text-(--danger)"
        style={{ color: "var(--text-muted)" }}
        aria-label={t("common:buttons.delete")}
        title={t("common:buttons.delete")}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        </svg>
      </button>
    </div>
  );
}
