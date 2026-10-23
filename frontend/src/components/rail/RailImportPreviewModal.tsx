import { useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { railApi } from "../../lib/api/rail";
import { busApi } from "../../lib/api/bus";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useSuggestionSwitchesStore } from "../../store/suggestionSwitchesStore";
import { logger } from "../../lib/logger";
import type { RailImportBooking } from "../../types/rail";
import { saveErrorFrom } from "./railFormModel";
import {
  isRowReady,
  rowsFrom,
  toImportInput,
  totalGoesTo,
  type RailImportRow,
} from "./railImportModel";
import { toBusInput } from "./railImportModes";
import { RailImportBookingFields } from "./RailImportBookingFields";
import { RailImportLegRow, type RowState } from "./RailImportLegRow";
import { RailImportRemember } from "./RailImportRemember";
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

/**
 * The review step for a parsed train ticket (spec 2026-09-25-rail-domain,
 * imports): every leg is shown and ticked by hand before anything is written.
 * A station the catalogue could not tie down unambiguously is asked for
 * rather than guessed, a ride already in the logbook starts unticked, and a
 * refused leg says why beside itself — the dialog closes only when every
 * ticked leg was saved.
 *
 * A bahn.de connection's U-Bahn, tram and bus legs are shown in their place
 * and start as the account remembered (`railImportModes.ts`); a skipped leg
 * never blocks the save, and the legs on either side of it are not bound into
 * one connection across the gap.
 */
export function RailImportPreviewModal({ booking, onCancel, onSaved }: Props): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  const busEnabled = useEnabledDomains().isEnabled("bus");
  const localTransit = useSuggestionSwitchesStore((s) => s.railImportLocalTransit);
  const bus = useSuggestionSwitchesStore((s) => s.railImportBus);
  const [rows, setRows] = useState<RailImportRow[]>(() =>
    rowsFrom(booking, { localTransit, bus, busEnabled })
  );
  const [states, setStates] = useState<RowState[]>(() =>
    booking.legs.map(() => ({ kind: "pending" }))
  );
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<RailBookingDraft>(() => bookingDraftFrom(booking));

  const update = (index: number, patch: Partial<RailImportRow>): void =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const toSave = rows
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row, index }) => row.selected && row.saveAs !== null && states[index].kind !== "saved"
    );
  const blocked = toSave.some(({ row }) => !isRowReady(row));
  const draftBlocked = draftProblems(draft).length > 0;
  const totalIndex = totalGoesTo(rows);

  const save = async (): Promise<void> => {
    setSaving(true);
    // The booking-wide facts as the user confirmed them, not as they were read.
    const confirmed = applyBookingDraft(booking, draft);
    const next = [...states];
    // The rail legs bind into one booking in travel order: each continues the
    // one before it — a leg saved now, or one already in the logbook. A leg
    // skipped, or saved as a bus ride, ends the chain: nothing is joined
    // across a gap the user left.
    let previousId: string | null = null;
    let failures = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const state = next[index];
      if (state.kind === "saved") {
        previousId = state.as === "rail" ? state.id : null;
        continue;
      }
      if (!row.selected || row.saveAs === null) {
        previousId = row.leg.duplicateOf;
        continue;
      }
      try {
        if (row.saveAs === "bus") {
          const ride = await busApi.create(toBusInput(confirmed, row));
          next[index] = { kind: "saved", id: ride.id, as: "bus" };
          previousId = null;
          continue;
        }
        const input = toImportInput(confirmed, row, index === totalIndex);
        const result = await railApi.create(
          previousId ? { ...input, connectsFrom: previousId } : input
        );
        next[index] = { kind: "saved", id: result.journey.id, as: "rail" };
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
          <RailImportLegRow
            key={`${row.leg.departureLocal}-${index}`}
            row={row}
            index={index}
            state={states[index]}
            busEnabled={busEnabled}
            onToggle={(selected): void => update(index, { selected })}
            onStation={(end, station): void => update(index, { [end]: station })}
            t={t}
          />
        ))}
      </ol>
      <RailImportRemember rows={rows} busEnabled={busEnabled} disabled={saving} t={t} />
      {blocked && (
        <p role="alert" className="mt-3 text-sm text-(--danger)" data-testid="rail-import-blocked">
          {t("rail:import.pickStations")}
        </p>
      )}
    </Modal>
  );
}
