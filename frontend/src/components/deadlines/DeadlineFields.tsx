import type { JSX } from "react";
import { useId, useMemo } from "react";
import { Field, Input } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { supportedZones } from "../../shared/time";
import { deadlineDraftError, type DeadlineDraft } from "./deadlineDraft";

interface Props {
  draft: DeadlineDraft;
  onChange: (next: DeadlineDraft) => void;
  /**
   * The entry names no place (a booking): a cancellation TIME then needs a
   * zone, so the field is shown and required. An entry with a place (a stay's
   * hotel, a rental's pickup) lets the server read that place's zone.
   */
  requireZone?: boolean;
}

/**
 * The deadlines a booking, a stay or a rental carries (forgejo#285): free
 * cancellation until a day (and optionally a time), and the day payment is
 * due. A day without a time is kept as a day — "until the end of" it.
 */
export function DeadlineFields({ draft, onChange, requireZone = false }: Props): JSX.Element {
  const { t } = useTranslation();
  const base = useId();
  const zones = useMemo(() => (requireZone ? supportedZones() : []), [requireZone]);
  const set = (key: keyof DeadlineDraft, value: string): void =>
    onChange({ ...draft, [key]: value });
  const timeError =
    deadlineDraftError(draft) === "timeWithoutDay"
      ? t("common:deadlines.form.timeWithoutDay")
      : requireZone && draft.cancelTime && !draft.cancelZone
        ? t("common:deadlines.form.zoneRequired")
        : undefined;
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="t-label mb-1">{t("common:deadlines.title")}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("common:deadlines.form.freeCancellationDate")} htmlFor={`${base}-day`}>
          <Input
            id={`${base}-day`}
            type="date"
            value={draft.cancelDay}
            onChange={(e) => set("cancelDay", e.target.value)}
          />
        </Field>
        <Field
          label={t("common:deadlines.form.freeCancellationTime")}
          htmlFor={`${base}-time`}
          hint={t("common:deadlines.form.freeCancellationTimeHint")}
          error={timeError}
        >
          <Input
            id={`${base}-time`}
            type="time"
            value={draft.cancelTime}
            onChange={(e) => set("cancelTime", e.target.value)}
          />
        </Field>
        {requireZone ? (
          <Field label={t("common:deadlines.form.zone")} htmlFor={`${base}-zone`}>
            <Input
              id={`${base}-zone`}
              list={`${base}-zones`}
              value={draft.cancelZone}
              placeholder="Europe/Berlin"
              onChange={(e) => set("cancelZone", e.target.value.trim())}
            />
          </Field>
        ) : null}
        {requireZone ? (
          <datalist id={`${base}-zones`}>
            {zones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        ) : null}
        <Field label={t("common:deadlines.form.paymentDueOn")} htmlFor={`${base}-pay`}>
          <Input
            id={`${base}-pay`}
            type="date"
            value={draft.paymentDueOn}
            onChange={(e) => set("paymentDueOn", e.target.value)}
          />
        </Field>
      </div>
    </fieldset>
  );
}

/** Whether the draft can be sent as it stands (the form's own submit gate). */
export function deadlineDraftValid(draft: DeadlineDraft, requireZone = false): boolean {
  if (deadlineDraftError(draft)) return false;
  return !(requireZone && draft.cancelTime && !draft.cancelZone);
}
