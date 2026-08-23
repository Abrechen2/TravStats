/**
 * Edit / duplicate / delete on a flight row.
 *
 * The icons come from the shared component every list uses now
 * (components/table/RowActionButton) — this file used to draw its own copies
 * of the same three glyphs. That mattered for more than tidiness: the row
 * navigates since 2026-08-22, and these buttons did not stop propagation, so
 * clicking "löschen" ALSO opened the flight it was about to remove. Found in
 * the browser; every unit test was green while it happened.
 *
 * Duplicate keeps its own button because it opens a menu rather than acting,
 * and the menu's two entries stop propagation for the same reason.
 */
import type { JSX, MouseEvent } from "react";
import type { Flight } from "../types";
import { useTranslation } from "../hooks/useTranslation";
import { RowActionButton, RowActions } from "./table/RowActionButton";

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

  const stop = (e: MouseEvent): void => e.stopPropagation();

  return (
    <RowActions>
      <RowActionButton
        icon="edit"
        label={t("common:buttons.edit")}
        onClick={() => onEdit(flight)}
      />

      <div className="relative" data-duplicate-menu onClick={stop}>
        <RowActionButton
          icon="duplicate"
          label={t("flights:table.duplicate.label")}
          onClick={() => onToggleDuplicateMenu(menuOpen ? null : flight.id)}
        />
        {menuOpen && (
          <div
            className="absolute right-0 mt-1 rounded-sm shadow-lg z-20 min-w-[180px]"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(flight, "same");
              }}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-(--bg-elevated)"
              style={{ color: "var(--text-primary)" }}
            >
              {t("flights:table.duplicate.same")}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(flight, "return");
              }}
              className="block w-full text-left px-3 py-2 text-xs hover:bg-(--bg-elevated)"
              style={{ color: "var(--text-primary)" }}
            >
              {t("flights:table.duplicate.return")}
            </button>
          </div>
        )}
      </div>

      <RowActionButton
        icon="delete"
        label={t("common:buttons.delete")}
        onClick={() => onDelete(flight.id)}
      />
    </RowActions>
  );
}
