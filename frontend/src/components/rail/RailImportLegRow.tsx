import type { JSX } from "react";
import { StationPicker } from "./StationPicker";
import { wallClockLabel, type RailImportRow } from "./railImportModel";
import { groupOf, modeLabelKey } from "./railImportModes";
import type { RailStationDraft } from "./RailStationField";
import type { RailImportStation } from "../../types/rail";
import { bareTrainName, trainName } from "../../lib/rail/trainName";

export type RowState =
  | { kind: "pending" }
  | { kind: "saved"; id: string; as: "rail" | "bus" }
  | { kind: "failed"; key: string };

type Translate = (key: string, options?: Record<string, unknown>) => string;

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary)";

/** bahn.de's own position, still the one in the draft (not replaced by a pick). */
const fromProvider = (station: RailImportStation, draft: RailStationDraft): boolean =>
  station.positionSource === "provider" &&
  draft.stationId === null &&
  draft.lat === station.lat &&
  draft.lon === station.lon;

/** What ticking this leg does, or why it cannot be ticked — said beside the box. */
function choiceNote(row: RailImportRow, busEnabled: boolean, t: Translate): string | null {
  const group = groupOf(row.leg);
  if (row.leg.transit?.mode === "ferry") return t("rail:import.mode.ferryNotHere");
  if (group === "bus") {
    return busEnabled ? t("rail:import.mode.asBus") : t("rail:import.mode.busDisabled");
  }
  if (group === "localTransit") return t("rail:import.mode.asLocalTransit");
  return null;
}

/** One leg of the review: its mode, its stations, and what ticking it saves. */
export function RailImportLegRow({
  row,
  index,
  state,
  busEnabled,
  onToggle,
  onStation,
  t,
}: {
  row: RailImportRow;
  index: number;
  state: RowState;
  busEnabled: boolean;
  onToggle: (selected: boolean) => void;
  onStation: (end: "departure" | "arrival", station: RailStationDraft) => void;
  t: Translate;
}): JSX.Element {
  const { leg } = row;
  const train = trainName(leg.trainCategory, leg.trainNumber, bareTrainName(t));
  const unresolved = (["departure", "arrival"] as const).filter(
    (end) => row[end].lat === null || row[end].lon === null
  );
  const placedByBahn = (["departure", "arrival"] as const).filter((end) =>
    fromProvider(end === "departure" ? leg.departureStation : leg.arrivalStation, row[end])
  );
  const modeKey = modeLabelKey(leg);
  const note = choiceNote(row, busEnabled, t);
  return (
    <li className="rounded-md border border-border p-3" data-testid={`rail-import-leg-${index}`}>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={row.selected}
          disabled={state.kind === "saved" || row.saveAs === null}
          onChange={(e): void => onToggle(e.target.checked)}
          aria-label={t("rail:import.takeLeg", { from: row.departure.name, to: row.arrival.name })}
        />
        <span className="flex flex-col">
          <span className="font-medium">
            {modeKey && (
              <span
                className="mr-2 rounded-sm border border-border px-1.5 py-0.5 text-xs font-normal"
                data-testid={`rail-import-mode-${index}`}
              >
                {t(modeKey)}
              </span>
            )}
            {row.departure.name} → {row.arrival.name}
          </span>
          <span className="t-caption">
            {wallClockLabel(leg.departureLocal)} – {wallClockLabel(leg.arrivalLocal)}
            {leg.direction ? ` · ${t(`rail:import.direction.${leg.direction}`)}` : ""}
            {` · ${train || t("rail:import.noTrain")}`}
            {leg.coach || leg.seat
              ? ` · ${t("rail:form.coach")} ${leg.coach ?? "—"}, ${t("rail:form.seatNumber")} ${leg.seat ?? "—"}`
              : ""}
          </span>
          {note && <span className="t-caption">{note}</span>}
          {placedByBahn.map((end) => {
            const km = (end === "departure" ? leg.departureStation : leg.arrivalStation)
              .catalogueConflictKm;
            return (
              <span
                key={end}
                className="t-caption"
                data-testid={`rail-import-bahn-position-${index}`}
              >
                {km
                  ? t("rail:import.positionFromBahnConflict", { name: row[end].name, km })
                  : t("rail:import.positionFromBahn", { name: row[end].name })}
              </span>
            );
          })}
          {leg.duplicateOf && (
            <span className="t-caption text-(--warning)">{t("rail:import.duplicate")}</span>
          )}
          {!leg.duplicateOf && leg.possibleDuplicateOf && (
            <span className="t-caption text-(--warning)">{t("rail:import.possibleDuplicate")}</span>
          )}
          {state.kind === "saved" && (
            <span className="t-caption text-(--success)">
              {t(state.as === "bus" ? "rail:import.legSavedAsBus" : "rail:import.legSaved")}
            </span>
          )}
          {state.kind === "failed" && (
            <span role="alert" className="t-caption text-(--danger)">
              {t(state.key)}
            </span>
          )}
        </span>
      </label>
      {row.selected && state.kind !== "saved" && unresolved.length > 0 && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {unresolved.map((end) => {
            const printed =
              end === "departure"
                ? leg.departureStation.printedName
                : leg.arrivalStation.printedName;
            return (
              <div key={end}>
                <p className="t-caption mb-1">{t("rail:import.unresolved", { name: printed })}</p>
                <StationPicker
                  label={t(
                    end === "departure" ? "rail:form.departureStation" : "rail:form.arrivalStation"
                  )}
                  idPrefix={`rail-import-${index}-${end}`}
                  printedName={printed}
                  value={row[end]}
                  onChange={(next): void => onStation(end, next)}
                  inputClassName={INPUT_CLASS}
                />
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}
