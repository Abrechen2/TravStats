import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type { CruiseStopInput } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { formatLocalClock, formatLocalDate } from "../../lib/displayFormat";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { stopTitle } from "./CruiseStopSummary";
import { moveStop, removeStop, stopShifts } from "./cruiseStopSequence";
import type { StopShift } from "./cruiseStopSequence";

// Labelled buttons with text, not "↑ ↓ ×" glyphs with a title: a glyph says
// nothing to a sighted touch user, and on an iPad there is no hover to read
// the title (forgejo#221, #249). 44 px on a coarse pointer.
const ACTION_CLASS =
  "rounded-md border border-border px-2 py-1 text-xs text-(--text-primary) hover:bg-(--bg-elevated) disabled:opacity-40 pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:px-3";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const day = (iso: string | null | undefined): string | null =>
  iso ? formatLocalDate(iso.slice(0, 10)) : null;

/** "Oslo Tag 3 → 5 (07.10.2026 → 09.10.2026)" — one moved neighbour, in words. */
function describeShift(t: Translate, shift: StopShift): string {
  const base = t("stops.preview.shift", {
    title: stopTitle(shift.stop, t),
    from: shift.dayBefore,
    to: shift.dayAfter,
  });
  if (shift.dateBefore === shift.dateAfter) return base;
  return `${base} (${t("stops.preview.shiftDate", {
    from: day(shift.dateBefore) ?? "–",
    to: day(shift.dateAfter) ?? "–",
  })})`;
}

function describeShifts(t: Translate, shifts: readonly StopShift[]): string {
  return shifts.length === 0
    ? t("stops.preview.orderOnly")
    : shifts.map((shift) => describeShift(t, shift)).join("; ");
}

interface Props {
  /** The whole itinerary, keyed (`withStopKeys`). */
  stops: readonly CruiseStopInput[];
  index: number;
  /** The cruise's start date ("YYYY-MM-DD" or ""), so derived dates can be previewed. */
  startDate: string;
  idFor: (part: string) => string;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

/**
 * The opened day's "move up / move down / remove" (forgejo#221), each saying
 * what it would do BEFORE it is pressed (forgejo#224): which other days get a
 * new number or date, that the excursion note travels with its port, and —
 * for a removal, which asks once more — the date, times and note that go.
 *
 * A day keeps its day of the cruise when moved (forgejo#126), so "Nach oben"
 * past a later day pushes THAT day on; the line under the buttons says so
 * ("Oslo Tag 3 → 5"), where before the user found out from the saved list.
 */
export function CruiseStopActions({
  stops,
  index,
  startDate,
  idFor,
  onMove,
  onRemove,
}: Props): JSX.Element {
  const { t } = useTranslation("cruise");
  const stop = stops[index];
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const reopenedRef = useRef(false);
  const removeId = idFor("remove");

  // Only when the question opens or closes — never on a re-render while it is
  // open, which would pull the focus off "Entfernen" back to "Behalten".
  useEffect(() => {
    if (confirming) {
      keepRef.current?.focus();
    } else if (reopenedRef.current) {
      // "Behalten" hands the focus back to the button that asked.
      reopenedRef.current = false;
      document.getElementById(removeId)?.focus();
    }
  }, [confirming]);

  const up = moveStop(stops, index, -1);
  const down = moveStop(stops, index, 1);
  const note = stop.excursionNote?.trim() ?? "";

  if (confirming) {
    const shifts = stopShifts(stops, removeStop(stops, index).next, startDate);
    const date = day(stop.date);
    const arrive = stop.arrivalTime ? formatLocalClock(stop.arrivalTime.slice(0, 16)) : null;
    const depart = stop.departureTime ? formatLocalClock(stop.departureTime.slice(0, 16)) : null;
    return (
      <div
        role="group"
        aria-labelledby={idFor("remove-title")}
        className="mb-3 rounded-md border border-(--danger)/50 bg-(--danger)/10 p-2 text-xs"
      >
        <p id={idFor("remove-title")} className="font-medium text-(--text-primary)">
          {t("stops.removeConfirm.title", { title: stopTitle(stop, t), day: stop.dayNumber })}
        </p>
        <ul className="mt-1 list-disc pl-4 text-(--text-muted)">
          {date && <li>{t("stops.removeConfirm.date", { date })}</li>}
          {(arrive || depart) && (
            <li>
              {t("stops.removeConfirm.times", { arrive: arrive ?? "–", depart: depart ?? "–" })}
            </li>
          )}
          {note && <li>{t("stops.removeConfirm.noteLost", { note })}</li>}
          <li>
            {shifts.length === 0
              ? t("stops.removeConfirm.othersKeep")
              : t("stops.removeConfirm.othersShift", { list: describeShifts(t, shifts) })}
          </li>
          <li>{t("stops.removeConfirm.undoHint")}</li>
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            ref={keepRef}
            id={idFor("keep")}
            type="button"
            onClick={(): void => {
              reopenedRef.current = true;
              setConfirming(false);
            }}
            className={ACTION_CLASS}
          >
            {t("stops.removeConfirm.keep")}
          </button>
          <button
            id={idFor("confirm-remove")}
            type="button"
            onClick={onRemove}
            className={`rounded-md px-2 py-1 text-xs font-medium text-white pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:px-3 ${DELETE_BUTTON_CLASS}`}
          >
            {t("stops.removeConfirm.confirm")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("stops.actionsLabel", { day: stop.dayNumber })}
      className="mb-3"
    >
      <div className="flex flex-wrap gap-2">
        <button
          id={idFor("up")}
          type="button"
          onClick={(): void => onMove(-1)}
          disabled={up === null}
          aria-describedby={up ? idFor("up-preview") : undefined}
          className={ACTION_CLASS}
        >
          <span aria-hidden="true">↑ </span>
          {t("stops.moveUp")}
        </button>
        <button
          id={idFor("down")}
          type="button"
          onClick={(): void => onMove(1)}
          disabled={down === null}
          aria-describedby={down ? idFor("down-preview") : undefined}
          className={ACTION_CLASS}
        >
          <span aria-hidden="true">↓ </span>
          {t("stops.moveDown")}
        </button>
        <button
          id={removeId}
          type="button"
          onClick={(): void => setConfirming(true)}
          className={`${ACTION_CLASS} text-(--danger)`}
        >
          {t("stops.remove")}
        </button>
      </div>
      <ul className="mt-1.5 text-xs text-(--text-muted)">
        {up && (
          <li id={idFor("up-preview")}>
            {t("stops.preview.up", {
              effect: describeShifts(t, stopShifts(stops, up.next, startDate)),
            })}
          </li>
        )}
        {down && (
          <li id={idFor("down-preview")}>
            {t("stops.preview.down", {
              effect: describeShifts(t, stopShifts(stops, down.next, startDate)),
            })}
          </li>
        )}
        {note && (up || down) && <li>{t("stops.preview.noteTravels")}</li>}
      </ul>
    </div>
  );
}
