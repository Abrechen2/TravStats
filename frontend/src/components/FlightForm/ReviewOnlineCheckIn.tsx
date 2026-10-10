import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import ReviewField, { REVIEW_INPUT } from "./ReviewField";

/**
 * When online check-in opens, as the parsed document states it (forgejo#285):
 * a wall clock at the departure airport, editable like the other parsed
 * fields. Empty sends nothing.
 */
export default function ReviewOnlineCheckIn({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["common"]);
  return (
    <ReviewField id={id} label={t("common:deadlines.onlineCheckIn")}>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 16))}
        className={REVIEW_INPUT}
      />
    </ReviewField>
  );
}

/** The request field: the departure airport's wall clock, or nothing. */
export function onlineCheckInRequest(value: string): { local: string } | undefined {
  return value ? { local: value.slice(0, 16) } : undefined;
}
