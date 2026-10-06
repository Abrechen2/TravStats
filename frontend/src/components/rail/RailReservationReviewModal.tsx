import { useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import { useTranslation } from "../../hooks/useTranslation";
import { railApi } from "../../lib/api/rail";
import { logger } from "../../lib/logger";
import type { RailImportBooking } from "../../types/rail";
import { saveErrorFrom } from "./railFormModel";
import { wallClockLabel } from "./railImportModel";
import {
  applicableTarget,
  reservationRowsFrom,
  reservationStatusKey,
  seatPatch,
  targetLabel,
  type ReservationRow,
} from "./railReservationModel";

interface Props {
  booking: RailImportBooking;
  onCancel: () => void;
  /** Every ticked seat was written — the only time the dialog closes itself. */
  onSaved: (applied: number) => void | Promise<void>;
}

type RowState = { kind: "pending" } | { kind: "saved" } | { kind: "failed"; key: string };

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The review of a seat reservation booked after the ticket (forgejo#203). It
 * writes no journey: each row names the logged journey its seat goes onto,
 * and applying it updates that journey's coach and seat through the ordinary
 * rail update. A row without exactly one journey says why and cannot be
 * ticked; a seat that would replace a different one starts unticked.
 */
export function RailReservationReviewModal({ booking, onCancel, onSaved }: Props): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  const [rows, setRows] = useState<ReservationRow[]>(() => reservationRowsFrom(booking));
  const [states, setStates] = useState<RowState[]>(() =>
    booking.legs.map(() => ({ kind: "pending" }))
  );
  const [saving, setSaving] = useState(false);

  const toApply = rows
    .map((row, index) => ({ row, index, target: applicableTarget(row.leg.reservation) }))
    .filter(({ row, index, target }) => row.selected && target && states[index].kind !== "saved");

  const apply = async (): Promise<void> => {
    setSaving(true);
    const next = [...states];
    let failures = 0;
    for (const { row, index, target } of toApply) {
      if (!target) continue;
      try {
        await railApi.update(target.id, seatPatch(row.leg));
        next[index] = { kind: "saved" };
      } catch (err: unknown) {
        logger.error("RailReservationReviewModal: a seat was refused", err);
        next[index] = { kind: "failed", key: saveErrorFrom(err).key };
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
      title={t("rail:import.reservation.title")}
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
            onClick={(): void => void apply()}
            disabled={saving || toApply.length === 0}
            className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) disabled:opacity-50"
          >
            {saving
              ? t("rail:form.saving")
              : t("rail:import.reservation.apply", { count: toApply.length })}
          </button>
        </>
      }
    >
      <p className="t-caption mb-3" data-testid="rail-reservation-intro">
        {t("rail:import.reservation.intro")}
      </p>
      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <ReservationLegRow
            key={`${row.leg.departureLocal}-${index}`}
            row={row}
            index={index}
            state={states[index]}
            onToggle={(selected): void =>
              setRows((prev) => prev.map((r, i) => (i === index ? { ...r, selected } : r)))
            }
            t={t}
          />
        ))}
      </ol>
    </Modal>
  );
}

function ReservationLegRow({
  row,
  index,
  state,
  onToggle,
  t,
}: {
  row: ReservationRow;
  index: number;
  state: RowState;
  onToggle: (selected: boolean) => void;
  t: Translate;
}): JSX.Element {
  const { leg } = row;
  const match = leg.reservation;
  const target = applicableTarget(match);
  const train = [leg.trainCategory, leg.trainNumber].filter(Boolean).join(" ");
  const seat = t("rail:import.reservation.seat", {
    coach: leg.coach ?? "—",
    seat: leg.seat ?? "—",
  });
  const subSection = match && "subSection" in match && match.subSection;
  return (
    <li
      className="rounded-md border border-border p-3"
      data-testid={`rail-reservation-leg-${index}`}
    >
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={row.selected && target !== null}
          disabled={target === null || state.kind === "saved"}
          onChange={(e): void => onToggle(e.target.checked)}
          aria-label={t("rail:import.reservation.take", {
            from: leg.depStationName,
            to: leg.arrStationName,
          })}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">
            {leg.depStationName} → {leg.arrStationName}
          </span>
          <span className="t-caption">
            {wallClockLabel(leg.departureLocal)} · {train || t("rail:import.noTrain")} · {seat}
          </span>
          {match && "target" in match && (
            <span data-testid={`rail-reservation-target-${index}`}>
              {t("rail:import.reservation.forJourney")}: {targetLabel(match.target)}
            </span>
          )}
          {subSection && (
            <span className="t-caption">
              {t("rail:import.reservation.subSection", {
                from: leg.depStationName,
                to: leg.arrStationName,
              })}
            </span>
          )}
          <span
            className={`t-caption ${match?.kind === "attach" ? "" : "text-(--warning)"}`}
            data-testid={`rail-reservation-status-${index}`}
          >
            {t(
              reservationStatusKey(match),
              match?.kind === "several"
                ? { count: match.targets.length }
                : {
                    coach: match && "target" in match ? (match.target.coach ?? "—") : "—",
                    seat: match && "target" in match ? (match.target.seat ?? "—") : "—",
                  }
            )}
          </span>
          {match?.kind === "several" && (
            <ul className="t-caption list-disc pl-5">
              {match.targets.map((candidate) => (
                <li key={candidate.id}>{targetLabel(candidate)}</li>
              ))}
            </ul>
          )}
          {state.kind === "saved" && (
            <span className="t-caption text-(--success)">
              {t("rail:import.reservation.applied")}
            </span>
          )}
          {state.kind === "failed" && (
            <span role="alert" className="t-caption text-(--danger)">
              {t(state.key)}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
