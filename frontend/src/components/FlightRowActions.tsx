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
      <button
        onClick={() => onEdit(flight)}
        className="px-3 py-1 text-xs font-medium rounded"
        style={{
          background: "rgba(56,139,253,0.15)",
          color: "#388bfd",
        }}
      >
        {t("common:buttons.edit")}
      </button>
      <div className="relative" data-duplicate-menu>
        <button
          onClick={() => onToggleDuplicateMenu(menuOpen ? null : flight.id)}
          className="px-3 py-1 text-xs font-medium rounded"
          style={{
            background: "rgba(139,148,158,0.15)",
            color: "var(--text-muted)",
          }}
          aria-label={t("flights:table.duplicate.label")}
          title={t("flights:table.duplicate.label")}
        >
          {t("flights:table.duplicate.label")}
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 mt-1 rounded shadow-lg z-20 min-w-[180px]"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <button
              onClick={() => onDuplicate(flight, "same")}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-elevated)]"
              style={{ color: "var(--text-primary)" }}
            >
              {t("flights:table.duplicate.same")}
            </button>
            <button
              onClick={() => onDuplicate(flight, "return")}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-elevated)]"
              style={{ color: "var(--text-primary)" }}
            >
              {t("flights:table.duplicate.return")}
            </button>
          </div>
        )}
      </div>
      <button
        onClick={() => onDelete(flight.id)}
        className="px-3 py-1 text-xs font-medium rounded"
        style={{
          background: "rgba(248,81,73,0.15)",
          color: "var(--danger)",
        }}
      >
        {t("common:buttons.delete")}
      </button>
    </div>
  );
}
