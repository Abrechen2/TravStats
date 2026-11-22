import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { Purpose } from "../../shared/purpose";

/** The value of the "not set" option; the server stores null for it. */
export const PURPOSE_UNSET = "";
export type PurposeChoice = Purpose | typeof PURPOSE_UNSET;

export const toChoice = (purpose: string | null | undefined): PurposeChoice =>
  purpose === "business" || purpose === "private" ? purpose : PURPOSE_UNSET;

/** The one purpose field of every form: not set, private or business. */
export default function PurposeSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: PurposeChoice;
  onChange: (next: PurposeChoice) => void;
  disabled?: boolean;
}): JSX.Element {
  const { t } = useTranslation(["purpose"]);
  return (
    <div>
      <label htmlFor={id} className="t-caption">
        {t("purpose:field.legend")}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as PurposeChoice)}
        className="pointer-coarse:min-h-(--ts-size-touch-min)"
        style={{ display: "block", minWidth: 160 }}
      >
        <option value={PURPOSE_UNSET}>{t("purpose:field.unknown")}</option>
        <option value="private">{t("purpose:field.private")}</option>
        <option value="business">{t("purpose:field.business")}</option>
      </select>
    </div>
  );
}
