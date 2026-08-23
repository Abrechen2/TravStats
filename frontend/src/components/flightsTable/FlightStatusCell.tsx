import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { statusPillStyle, STATUS_PILL_CLASS } from "../table/statusPillStyle";
import { deriveFlightStatus } from "../../shared/statusDerivation";
import type { Flight } from "../../types";

/**
 * A flight's status — and, separately, whether the row is a duplicate.
 *
 * `duplicated` is stored in the same column as scheduled/flown/cancelled/
 * historical, so it used to be drawn as a status pill like the rest. But the
 * other four say where the flight is in time; "dupliziert" says something about
 * the RECORD. Putting both in one pill meant a duplicate had no travel state at
 * all on screen: the row could not tell you whether the flight it duplicates
 * had already happened.
 *
 * So the pill shows what the dates say, and the duplicate rides along as a grey
 * tag — the same neutral chip the lodging list uses for "keine Adresse", which
 * is the same kind of statement. Neutral surface, no colour of its own
 * (BRAND.md's don't-list): a duplicate is not an alarm.
 *
 * The stored value is untouched. Filtering, the statistics exclusion and the
 * achievement counter all still read `status === "duplicated"`; only the
 * drawing changed.
 */
export default function FlightStatusCell({ flight }: { flight: Flight }): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const isDuplicate = flight.status === "duplicated";

  // For a duplicate, ask the dates instead of the stored marker.
  const shown = isDuplicate
    ? deriveFlightStatus({
        departureTime: flight.departureTime ? new Date(flight.departureTime) : null,
        arrivalTime: flight.arrivalTime ? new Date(flight.arrivalTime) : null,
        current: "scheduled",
        passthrough: false,
      })
    : flight.status;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={STATUS_PILL_CLASS} style={statusPillStyle(shown)}>
        {t(`flights:status.${shown}`, { defaultValue: shown })}
      </span>
      {isDuplicate && (
        <span
          data-testid={`flight-duplicate-${flight.id}`}
          title={t("flights:status.duplicatedHint")}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-(--bg-elevated) px-2 py-0.5 text-xs text-(--text-muted)"
        >
          <span aria-hidden>⧉</span>
          {t("flights:status.duplicated")}
        </span>
      )}
    </span>
  );
}
