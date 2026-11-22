/**
 * Edit / duplicate / delete on a flight row, as one ⋯ (owner, 2026-11-22).
 *
 * The row navigates (since 2026-08-22), and the old delete icon did not stop propagation, so
 * clicking "löschen" ALSO opened the flight it was about to remove — found in the browser,
 * every unit test was green. `RowMenu` stops the click for the trigger and the panel alike.
 * The hand-rolled duplicate popover (no keyboard handling) is now two entries of the shared menu.
 */
import type { JSX } from "react";
import type { Flight } from "../types";
import { useTranslation } from "../hooks/useTranslation";
import RowMenu from "./table/RowMenu";

interface Props {
  flight: Flight;
  onEdit: (flight: Flight) => void;
  onDuplicate: (flight: Flight, mode: "return" | "same") => void;
  onDelete: (id: string) => void;
}

export default function FlightRowActions({
  flight,
  onEdit,
  onDuplicate,
  onDelete,
}: Props): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  return (
    <RowMenu
      testId={`flight-menu-${flight.id}`}
      entries={[
        { key: "edit", label: t("common:buttons.edit"), onSelect: () => onEdit(flight) },
        {
          key: "dup-same",
          label: t("flights:table.duplicate.same"),
          onSelect: () => onDuplicate(flight, "same"),
        },
        {
          key: "dup-return",
          label: t("flights:table.duplicate.return"),
          onSelect: () => onDuplicate(flight, "return"),
        },
        {
          key: "delete",
          label: t("common:buttons.delete"),
          danger: true,
          onSelect: () => onDelete(flight.id),
        },
      ]}
    />
  );
}
