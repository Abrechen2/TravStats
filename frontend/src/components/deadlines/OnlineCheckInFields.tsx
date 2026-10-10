import type { JSX } from "react";
import { useId } from "react";
import { Field, Input } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import type { TimeValue } from "../../shared/time";

/**
 * When online check-in opens (forgejo#285): a day and a time on the
 * departure airport's clock — the server reads that zone, so none is asked.
 * Both or neither: an opening is a moment, not a day.
 */
export interface OnlineCheckInDraft {
  day: string;
  time: string;
}

export function onlineCheckInDraftFrom(value: TimeValue | null | undefined): OnlineCheckInDraft {
  return value
    ? { day: value.local.slice(0, 10), time: value.local.slice(11, 16) }
    : { day: "", time: "" };
}

export function onlineCheckInDraftValid(draft: OnlineCheckInDraft): boolean {
  return Boolean(draft.day) === Boolean(draft.time);
}

/** Only a change goes out; an emptied pair clears. */
export function onlineCheckInWire(
  draft: OnlineCheckInDraft,
  initial: OnlineCheckInDraft
): { onlineCheckInOpensAt?: { local: string } | null } {
  if (draft.day === initial.day && draft.time === initial.time) return {};
  if (!draft.day || !draft.time) return { onlineCheckInOpensAt: null };
  return { onlineCheckInOpensAt: { local: `${draft.day}T${draft.time}` } };
}

interface Props {
  draft: OnlineCheckInDraft;
  onChange: (next: OnlineCheckInDraft) => void;
}

export function OnlineCheckInFields({ draft, onChange }: Props): JSX.Element {
  const { t } = useTranslation(["common"]);
  const base = useId();
  const error = onlineCheckInDraftValid(draft)
    ? undefined
    : t("common:deadlines.form.checkInNeedsBoth");
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label={t("common:deadlines.form.onlineCheckInDate")} htmlFor={`${base}-day`}>
        <Input
          id={`${base}-day`}
          type="date"
          value={draft.day}
          onChange={(e) => onChange({ ...draft, day: e.target.value })}
        />
      </Field>
      <Field
        label={t("common:deadlines.form.onlineCheckInTime")}
        htmlFor={`${base}-time`}
        error={error}
      >
        <Input
          id={`${base}-time`}
          type="time"
          value={draft.time}
          onChange={(e) => onChange({ ...draft, time: e.target.value })}
        />
      </Field>
    </div>
  );
}
