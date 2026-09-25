import { useTranslation } from "../../../hooks/useTranslation";
import SuggestionChips from "../../common/SuggestionChips";

/** The five booking-side fields, shared between the create and edit flight
 *  forms. The last three (booking class letter, baggage allowance, frequent
 *  flyer number) are persisted and parser-filled but were rendered by
 *  NEITHER form until #199 — the only way to see or correct them was the
 *  Excel round trip. */
export interface BookingFieldsValue {
  bookingReference: string;
  ticketNumber: string;
  bookingClassLetter: string;
  baggageAllowance: string;
  frequentFlyerNumber: string;
}

interface BookingFieldsProps {
  value: BookingFieldsValue;
  onChange: (value: BookingFieldsValue) => void;
  /** The create form's density classes; the edit modal passes neither. */
  labelClassName?: string;
  inputClassName?: string;
  /** The number from the user's latest flight with this airline, offered as a
   *  chip while the field is empty. */
  frequentFlyerSuggestion?: string | null;
  /** The field holds that number because the form filled it in, not the
   *  user — says so under the field. */
  frequentFlyerSuggested?: boolean;
}

export default function BookingFields({
  value,
  onChange,
  labelClassName = "",
  inputClassName = "",
  frequentFlyerSuggestion = null,
  frequentFlyerSuggested = false,
}: BookingFieldsProps): JSX.Element {
  const { t } = useTranslation(["flights"]);

  const set = (field: keyof BookingFieldsValue, fieldValue: string): void =>
    onChange({ ...value, [field]: fieldValue });

  const labelClass = `label ${labelClassName}`.trim();
  const inputClass = `input ${inputClassName}`.trim();

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>{t("flights:form.bookingReference")}</label>
          <input
            type="text"
            value={value.bookingReference}
            // A PNR is canonically uppercase — the create form always did
            // this; the edit form gains it through the shared component.
            onChange={(e) => set("bookingReference", e.target.value.toUpperCase())}
            className={inputClass}
            placeholder={t("flights:form.placeholders.bookingReference")}
          />
        </div>
        <div>
          <label className={labelClass}>{t("flights:form.ticketNumber")}</label>
          <input
            type="text"
            value={value.ticketNumber}
            onChange={(e) => set("ticketNumber", e.target.value)}
            className={inputClass}
            placeholder={t("flights:form.placeholders.ticketNumber")}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={labelClass}>{t("flights:form.bookingClassLetter")}</label>
          <input
            type="text"
            value={value.bookingClassLetter}
            onChange={(e) => set("bookingClassLetter", e.target.value.toUpperCase())}
            className={inputClass}
            placeholder={t("flights:form.placeholders.bookingClassLetter")}
            // Mirrors the backend bound (schemas/flight.ts: max 5).
            maxLength={5}
          />
        </div>
        <div>
          <label className={labelClass}>{t("flights:form.baggageAllowance")}</label>
          <input
            type="text"
            value={value.baggageAllowance}
            onChange={(e) => set("baggageAllowance", e.target.value)}
            className={inputClass}
            placeholder={t("flights:form.placeholders.baggageAllowance")}
            maxLength={50}
          />
        </div>
        <div>
          <label className={labelClass}>{t("flights:form.frequentFlyerNumber")}</label>
          <input
            type="text"
            value={value.frequentFlyerNumber}
            onChange={(e) => set("frequentFlyerNumber", e.target.value)}
            className={inputClass}
            placeholder={t("flights:form.placeholders.frequentFlyerNumber")}
            maxLength={30}
          />
          {frequentFlyerSuggested ? (
            <p className="mt-1 text-xs text-(--text-muted)">
              {t("flights:form.frequentFlyerSuggested")}
            </p>
          ) : (
            !value.frequentFlyerNumber &&
            frequentFlyerSuggestion && (
              <SuggestionChips
                value=""
                suggestions={[frequentFlyerSuggestion]}
                onPick={(v) => set("frequentFlyerNumber", v)}
                fieldLabel={t("flights:form.frequentFlyerNumber")}
              />
            )
          )}
        </div>
      </div>
    </>
  );
}
