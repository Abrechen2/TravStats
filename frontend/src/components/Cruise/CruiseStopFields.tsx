import type { JSX } from "react";
import type { CruiseStopInput, Port } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { ClockChangeNotice } from "../common/ClockChangeNotice";
import { PortPicker } from "./PortPicker";

// Stop arrival/departure are PORT-LOCAL wall-clock times — a ship arrives at
// "08:00" in the port's own time, independent of the viewer's timezone. Treat
// the datetime-local value as timezone-neutral and pin it to a literal UTC
// instant. Using `new Date(value).toISOString()` instead shifted the time by
// the browser's UTC offset on every save (display sliced the UTC ISO straight
// back), so a stored "08:00" reappeared as "06:00" and could roll to the
// previous day — the same asymmetry that dropped cruise start/end dates.
const fromStopInput = (local: string): string | null => (local ? `${local}:00.000Z` : null);

// Stop date is date-granular (the calendar day of the call). Pin to UTC
// midnight so the round-trip stays timezone-neutral, same as the cruise
// start/end dates — see CruiseEditModal for the rationale.
const fromDateInput = (date: string): string | null => (date ? `${date}T00:00:00.000Z` : null);

// Fields of an opened day. On a finger-operated screen every control reaches
// the 44 px minimum (forgejo#249, iPad findings: inputs at 38 px were the
// commonest miss); a mouse keeps the compact sizes.
const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-elevated) px-2 py-1 text-sm text-(--text-primary) pointer-coarse:min-h-(--ts-size-touch-min)";
const LABEL_CLASS = "flex flex-col gap-1 text-xs text-(--text-muted)";

interface Props {
  stop: CruiseStopInput;
  /** Prefix of every control id of this day, unique on the page. */
  idBase: string;
  onPatch: (patch: Partial<CruiseStopInput>) => void;
  /** Ids of messages that describe the port field (a missing port, forgejo#245). */
  portDescribedBy?: string;
  portInvalid?: boolean;
}

/**
 * The fields of ONE day of the itinerary, shown when the day is opened in the
 * stops editor (forgejo#221). Every field has a visible label — before, the
 * excursion note had only its placeholder and the times only an aria-label,
 * so a sighted user saw two unnamed clocks (forgejo#249).
 *
 * Toggling "Auf See" clears the port and an unresolved name, and picking a
 * port clears the unresolved name: the three-state stop invariant
 * (CLAUDE.md, "Cruise stops") — a stop is a port, a sea day or an unresolved
 * port, never two of them.
 */
export function CruiseStopFields({
  stop,
  idBase,
  onPatch,
  portDescribedBy,
  portInvalid,
}: Props): JSX.Element {
  const { t } = useTranslation("cruise");

  const onPortPicked = (port: Port): void => {
    onPatch({ portId: port.id, port, unresolvedPortName: null });
  };

  return (
    <div className="flex flex-col gap-2">
      <label className={LABEL_CLASS}>
        {t("stops.date")}
        <input
          id={`${idBase}-date`}
          type="date"
          value={stop.date?.slice(0, 10) ?? ""}
          onChange={(e): void =>
            onPatch({ date: fromDateInput(e.target.value), dateSource: "user" })
          }
          style={{ colorScheme: "dark" }}
          className={INPUT_CLASS}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-(--text-muted) pointer-coarse:min-h-(--ts-size-touch-min)">
        <input
          type="checkbox"
          checked={stop.isAtSea}
          onChange={(e): void =>
            onPatch({
              isAtSea: e.target.checked,
              portId: e.target.checked ? null : stop.portId,
              port: e.target.checked ? null : stop.port,
              unresolvedPortName: e.target.checked ? null : stop.unresolvedPortName,
            })
          }
          className="pointer-coarse:h-5 pointer-coarse:w-5"
        />
        {t("stops.at_sea")}
      </label>
      {!stop.isAtSea && (
        <>
          {stop.portId == null && stop.unresolvedPortName ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
              <span className="font-medium">🔶 {t("stops.unresolved")}:</span>{" "}
              {stop.unresolvedPortName}
              <div className="mt-0.5 text-[11px] text-amber-300/80">
                {t("stops.unresolvedHint")}
              </div>
            </div>
          ) : null}
          <PortPicker
            id={`${idBase}-port`}
            label={t("stops.port")}
            value={stop.port ?? null}
            onChange={onPortPicked}
            describedBy={portDescribedBy}
            invalid={portInvalid}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>
                {t("stops.arrival")}
                <input
                  id={`${idBase}-arrival`}
                  type="datetime-local"
                  value={stop.arrivalTime?.slice(0, 16) ?? ""}
                  onChange={(e): void =>
                    onPatch({
                      arrivalTime: fromStopInput(e.target.value),
                      arrivalFold: undefined,
                    })
                  }
                  className={INPUT_CLASS}
                />
              </label>
              <ClockChangeNotice
                local={stop.arrivalTime?.slice(0, 16) ?? ""}
                zone={stop.port?.timezone}
                fold={stop.arrivalFold}
                onFoldChange={(fold): void => onPatch({ arrivalFold: fold })}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>
                {t("stops.departure")}
                <input
                  id={`${idBase}-departure`}
                  type="datetime-local"
                  value={stop.departureTime?.slice(0, 16) ?? ""}
                  onChange={(e): void =>
                    onPatch({
                      departureTime: fromStopInput(e.target.value),
                      departureFold: undefined,
                    })
                  }
                  className={INPUT_CLASS}
                />
              </label>
              <ClockChangeNotice
                local={stop.departureTime?.slice(0, 16) ?? ""}
                zone={stop.port?.timezone}
                fold={stop.departureFold}
                onFoldChange={(fold): void => onPatch({ departureFold: fold })}
              />
            </div>
          </div>
          {/* Its own field, typed from the ship's daily programme: the time
              to be back on board is NOT the departure, and the gap differs
              by line and port — so nothing fills it in (forgejo#223). */}
          <div className="flex flex-col gap-1">
            <label className={LABEL_CLASS}>
              {t("stops.allAboard")}
              <input
                id={`${idBase}-all-aboard`}
                type="time"
                value={stop.allAboardTime ?? ""}
                onChange={(e): void => onPatch({ allAboardTime: e.target.value || null })}
                aria-describedby={`${idBase}-all-aboard-hint`}
                style={{ colorScheme: "dark" }}
                className={INPUT_CLASS}
              />
            </label>
            <p id={`${idBase}-all-aboard-hint`} className="text-xs text-(--text-muted)">
              {t("stops.allAboardHint")}
            </p>
          </div>
          <label className={LABEL_CLASS}>
            {t("stops.excursion")}
            <textarea
              id={`${idBase}-excursion`}
              value={stop.excursionNote ?? ""}
              onChange={(e): void => onPatch({ excursionNote: e.target.value })}
              rows={2}
              className={INPUT_CLASS}
            />
          </label>
        </>
      )}
    </div>
  );
}
