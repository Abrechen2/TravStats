import { useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { railApi } from "../../lib/api/rail";
import { logger } from "../../lib/logger";
import type { RailImportBooking } from "../../types/rail";
import { StationPicker } from "./StationPicker";
import { saveErrorFrom } from "./railFormModel";
import {
  isRowReady,
  rowsFrom,
  toImportInput,
  totalGoesTo,
  wallClockLabel,
  type RailImportRow,
} from "./railImportModel";
import type { RailStationDraft } from "./RailStationField";
import { RailImportBookingFields } from "./RailImportBookingFields";
import {
  applyBookingDraft,
  bookingDraftFrom,
  draftProblems,
  type RailBookingDraft,
} from "./railImportBookingDraft";

interface Props {
  booking: RailImportBooking;
  onCancel: () => void;
  /** Every ticked leg was saved — the only time the dialog closes itself. */
  onSaved: (created: number) => void | Promise<void>;
}

type RowState =
  { kind: "pending" } | { kind: "saved"; id: string } | { kind: "failed"; key: string };

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-2 text-sm text-(--text-primary)";

/**
 * The review step for a parsed train ticket (spec 2026-09-25-rail-domain,
 * imports): every leg is shown and ticked by hand before anything is written.
 * A station the catalogue could not tie down unambiguously is asked for
 * rather than guessed, a ride already in the logbook starts unticked, and a
 * refused leg says why beside itself — the dialog closes only when every
 * ticked leg was saved.
 */
export function RailImportPreviewModal({ booking, onCancel, onSaved }: Props): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  const [rows, setRows] = useState<RailImportRow[]>(() => rowsFrom(booking));
  const [states, setStates] = useState<RowState[]>(() =>
    booking.legs.map(() => ({ kind: "pending" }))
  );
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<RailBookingDraft>(() => bookingDraftFrom(booking));

  const update = (index: number, patch: Partial<RailImportRow>): void =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const toSave = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => row.selected && states[index].kind !== "saved");
  const blocked = toSave.some(({ row }) => !isRowReady(row));
  const draftBlocked = draftProblems(draft).length > 0;
  const totalIndex = totalGoesTo(rows);

  const save = async (): Promise<void> => {
    setSaving(true);
    // The booking-wide facts as the user confirmed them, not as they were read.
    const confirmed = applyBookingDraft(booking, draft);
    const next = [...states];
    // The legs bind into one booking in travel order: each continues the one
    // before it — a leg saved now, or one already in the logbook.
    let previousId: string | null = null;
    let failures = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const state = next[index];
      if (state.kind === "saved") {
        previousId = state.id;
        continue;
      }
      if (!row.selected) {
        previousId = row.leg.duplicateOf ?? previousId;
        continue;
      }
      try {
        const input = toImportInput(confirmed, row, index === totalIndex);
        const result = await railApi.create(
          previousId ? { ...input, connectsFrom: previousId } : input
        );
        next[index] = { kind: "saved", id: result.journey.id };
        previousId = result.journey.id;
      } catch (err: unknown) {
        logger.error("RailImportPreviewModal: a leg was refused", err);
        // Each leg is a create: a lost answer may have stored it.
        next[index] = { kind: "failed", key: saveErrorFrom(err, { create: true }).key };
        failures += 1;
      }
    }
    setStates(next);
    setSaving(false);
    if (failures === 0) await onSaved(next.filter((s) => s.kind === "saved").length);
  };

  return (
    <Modal
      open
      onClose={onCancel}
      busy={saving}
      maxWidth={760}
      closeLabel={t("common:buttons.close")}
      title={t("rail:import.title")}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-border px-4 py-2 text-sm"
          >
            {t("rail:form.cancel")}
          </button>
          <button
            type="button"
            onClick={(): void => void save()}
            disabled={saving || toSave.length === 0 || blocked || draftBlocked}
            className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) disabled:opacity-50"
          >
            {saving ? t("rail:form.saving") : t("rail:import.save", { count: toSave.length })}
          </button>
        </>
      }
    >
      <RailImportBookingFields
        booking={booking}
        draft={draft}
        onChange={(patch): void => setDraft((prev) => ({ ...prev, ...patch }))}
        totalNotWritten={totalIndex < 0}
        disabled={saving}
      />
      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <LegRow
            key={`${row.leg.departureLocal}-${index}`}
            row={row}
            index={index}
            state={states[index]}
            onToggle={(selected): void => update(index, { selected })}
            onStation={(end, station): void => update(index, { [end]: station })}
            t={t}
          />
        ))}
      </ol>
      {blocked && (
        <p role="alert" className="mt-3 text-sm text-(--danger)" data-testid="rail-import-blocked">
          {t("rail:import.pickStations")}
        </p>
      )}
    </Modal>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function LegRow({
  row,
  index,
  state,
  onToggle,
  onStation,
  t,
}: {
  row: RailImportRow;
  index: number;
  state: RowState;
  onToggle: (selected: boolean) => void;
  onStation: (end: "departure" | "arrival", station: RailStationDraft) => void;
  t: Translate;
}): JSX.Element {
  const { leg } = row;
  const train = [leg.trainCategory, leg.trainNumber].filter(Boolean).join(" ");
  const unresolved = (["departure", "arrival"] as const).filter(
    (end) => row[end].lat === null || row[end].lon === null
  );
  return (
    <li className="rounded-md border border-border p-3" data-testid={`rail-import-leg-${index}`}>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={row.selected}
          disabled={state.kind === "saved"}
          onChange={(e): void => onToggle(e.target.checked)}
          aria-label={t("rail:import.takeLeg", { from: row.departure.name, to: row.arrival.name })}
        />
        <span className="flex flex-col">
          <span className="font-medium">
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
          {leg.duplicateOf && (
            <span className="t-caption text-(--warning)">{t("rail:import.duplicate")}</span>
          )}
          {state.kind === "saved" && (
            <span className="t-caption text-(--success)">{t("rail:import.legSaved")}</span>
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
          {unresolved.map((end) => (
            <div key={end}>
              <p className="t-caption mb-1">
                {t("rail:import.unresolved", {
                  name:
                    end === "departure"
                      ? leg.departureStation.printedName
                      : leg.arrivalStation.printedName,
                })}
              </p>
              <StationPicker
                label={t(
                  end === "departure" ? "rail:form.departureStation" : "rail:form.arrivalStation"
                )}
                idPrefix={`rail-import-${index}-${end}`}
                printedName={
                  end === "departure"
                    ? leg.departureStation.printedName
                    : leg.arrivalStation.printedName
                }
                value={row[end]}
                onChange={(next): void => onStation(end, next)}
                inputClassName={INPUT_CLASS}
              />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
