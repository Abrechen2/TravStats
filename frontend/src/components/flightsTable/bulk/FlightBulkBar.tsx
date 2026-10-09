import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { Flight, Trip } from "../../../types";
import FlightBulkEditModal from "./FlightBulkEditModal";
import type { FlightSelection } from "./useFlightSelection";

const BAR_BUTTON =
  "rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-surface)] disabled:opacity-50 pointer-coarse:min-h-(--ts-size-touch-min)";

/**
 * The selection's own bar (forgejo#217): how many are chosen, "alle auf dieser
 * Seite", "Auswahl aufheben", and the one action that acts on them. Shown
 * only while selecting, so the ordinary list stays as it was.
 */
export default function FlightBulkBar({
  selection,
  pageFlights,
  trips,
  labelOf,
  onApplied,
}: {
  selection: FlightSelection;
  pageFlights: readonly Flight[];
  trips: readonly Trip[];
  labelOf: (flightId: string) => string;
  onApplied: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["flights", "common"]);
  const [editing, setEditing] = useState(false);
  if (!selection.selecting) return null;
  const count = selection.selected.size;
  return (
    <div
      className="mb-3 flex flex-wrap items-center rounded-md p-2"
      style={{ gap: 8, background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
      data-testid="flight-bulk-bar"
    >
      <span role="status" className="mr-auto text-sm font-semibold">
        {t("flights:bulk.selected", { count })}
      </span>
      <button type="button" className={BAR_BUTTON} onClick={() => selection.selectAll(pageFlights)}>
        {t("flights:bulk.selectPage")}
      </button>
      <button type="button" className={BAR_BUTTON} onClick={selection.clear} disabled={count === 0}>
        {t("flights:bulk.clearSelection")}
      </button>
      <button
        type="button"
        className={`${BAR_BUTTON} bg-[var(--accent)] text-neutral-900`}
        onClick={() => setEditing(true)}
        disabled={count === 0}
      >
        {t("flights:bulk.edit", { count })}
      </button>
      <button type="button" className={BAR_BUTTON} onClick={selection.stop}>
        {t("flights:bulk.stop")}
      </button>
      {editing ? (
        <FlightBulkEditModal
          flights={[...selection.selected.values()]}
          trips={trips}
          labelOf={labelOf}
          onClose={() => setEditing(false)}
          onApplied={onApplied}
        />
      ) : null}
    </div>
  );
}
