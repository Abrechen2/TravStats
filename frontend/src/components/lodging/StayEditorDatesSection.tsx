import type { JSX, ReactNode } from "react";
import { Field } from "../ui/Field";
import { RequiredMark } from "../form";
import { StayEditorSection } from "./StayEditorSection";
import { StayDatesOfferButton } from "./StayDatesOfferButton";
import { LODGING_DATE_PRECISIONS, type LodgingDatePrecision } from "../../shared/lodgingTiming";
import type { StayDatesOffer } from "../../hooks/useStayDatesFromTrip";
import type { StayStatus } from "../../types/lodging";

type T = (key: string, options?: Record<string, unknown>) => string;

// color-scheme: dark - see CruiseEditModal.tsx for why date inputs need this.
const DARK_PICKER_STYLE: React.CSSProperties = { colorScheme: "dark" };

/** "2011-07" -> "2011-07-01", "2011" -> "2011-01-01"; a day passes through. */
function precisionToIsoDay(raw: string, precision: LodgingDatePrecision): string {
  if (!raw) return "";
  if (precision === "MONTH") return `${raw}-01`;
  if (precision === "YEAR") return `${raw.padStart(4, "0")}-01-01`;
  return raw;
}

interface StayEditorDatesSectionProps {
  /** Prefix of the field ids (the editor's `useId`). */
  fid: string;
  t: T;
  inputClassName: string;
  datePrecision: LodgingDatePrecision;
  onPrecisionChange: (precision: LodgingDatePrecision) => void;
  checkIn: string;
  onCheckInChange: (day: string) => void;
  checkOut: string;
  onCheckOutChange: (day: string) => void;
  checkInTime: string;
  onCheckInTimeChange: (time: string) => void;
  checkOutTime: string;
  onCheckOutTimeChange: (time: string) => void;
  nightsText: string;
  onNightsChange: (text: string) => void;
  isCancelled: boolean;
  onCancelledChange: (cancelled: boolean) => void;
  derivedStatus: StayStatus;
  tripOffer: StayDatesOffer | null;
  onAcceptTripOffer: () => void;
  /** Already translated, shown beside the field once a save was attempted. */
  errors: { checkIn?: string; checkOut?: string };
  /** The room fields, which live in the same section. */
  children: ReactNode;
}

/** Stable ids for the two required fields. */
const stayDateFieldIds = (fid: string): { checkIn: string; checkOut: string } => ({
  checkIn: `${fid}-checkIn`,
  checkOut: `${fid}-checkOut`,
});

/**
 * The "Termine" group of the stay editor: how much of the date is known, the
 * two ends, their optional clock times, the night count where the dates cannot
 * give one, and the cancellation. Moved out of `StayEditor` (which sits at the
 * 800-line limit) when the required marks and field errors arrived.
 */
export function StayEditorDatesSection({
  fid,
  t,
  inputClassName,
  datePrecision,
  onPrecisionChange,
  checkIn,
  onCheckInChange,
  checkOut,
  onCheckOutChange,
  checkInTime,
  onCheckInTimeChange,
  checkOutTime,
  onCheckOutTimeChange,
  nightsText,
  onNightsChange,
  isCancelled,
  onCancelledChange,
  derivedStatus,
  tripOffer,
  onAcceptTripOffer,
  errors,
  children,
}: StayEditorDatesSectionProps): JSX.Element {
  const ids = stayDateFieldIds(fid);
  // A month input speaks "YYYY-MM" and a year input a bare number, but the
  // column stores a full date either way - the FIRST of the period, marked as
  // a placeholder by `datePrecision`. These two convert between the two
  // vocabularies in one place so the form and the payload cannot disagree.
  const precisionInputValue =
    datePrecision === "MONTH"
      ? checkIn.slice(0, 7)
      : datePrecision === "YEAR"
        ? checkIn.slice(0, 4)
        : checkIn;

  return (
    <StayEditorSection title={t("lodging:stayEditor.datesSection")}>
      {/* The precision picker comes FIRST because it decides which of the
          fields below make sense. Offering two date inputs and then
          refusing the save is the behaviour this replaces. */}
      <label htmlFor={`${fid}-precision`} className="mb-1 block text-xs text-[var(--text-muted)]">
        {t("lodging:period.precision.label")}
      </label>
      <select
        id={`${fid}-precision`}
        data-testid="stay-date-precision"
        className={inputClassName}
        value={datePrecision}
        onChange={(e): void => onPrecisionChange(e.target.value as LodgingDatePrecision)}
      >
        {LODGING_DATE_PRECISIONS.map((p) => (
          <option key={p} value={p}>
            {t(`lodging:period.precision.${p}`)}
          </option>
        ))}
      </select>
      <p className="mb-3 mt-1 text-xs text-[var(--text-muted)]">
        {t(`lodging:period.precision.${datePrecision}Hint`)}
      </p>

      {datePrecision !== "NONE" && (
        // Named on screen, not by aria-label: two bare native pickers side by
        // side did not say which end was which (CT106 design-6 R06). Marked
        // required where the chosen precision demands them.
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={
              <>
                {t("lodging:field.checkIn")} <RequiredMark />
              </>
            }
            htmlFor={ids.checkIn}
            error={errors.checkIn}
          >
            <input
              id={ids.checkIn}
              aria-required="true"
              type={
                datePrecision === "MONTH" ? "month" : datePrecision === "YEAR" ? "number" : "date"
              }
              className={inputClassName}
              style={DARK_PICKER_STYLE}
              value={precisionInputValue}
              onChange={(e): void =>
                onCheckInChange(precisionToIsoDay(e.target.value, datePrecision))
              }
            />
          </Field>
          {datePrecision === "DAY" && (
            <Field
              label={
                <>
                  {t("lodging:field.checkOut")} <RequiredMark />
                </>
              }
              htmlFor={ids.checkOut}
              error={errors.checkOut}
            >
              <input
                id={ids.checkOut}
                aria-required="true"
                type="date"
                className={inputClassName}
                style={DARK_PICKER_STYLE}
                value={checkOut}
                onChange={(e): void => onCheckOutChange(e.target.value)}
              />
            </Field>
          )}
        </div>
      )}
      {tripOffer && <StayDatesOfferButton offer={tripOffer} onAccept={onAcceptTripOffer} t={t} />}

      {/* Optional times, DAY precision only - mainly so a planned stay's
          "Als Nächstes" countdown points at the real check-in, not at
          midnight. */}
      {datePrecision === "DAY" && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={t("lodging:field.checkInTime")}
            htmlFor={`${fid}-checkInTime`}
            hint={t("lodging:field.checkInTimeHint")}
          >
            <input
              id={`${fid}-checkInTime`}
              type="time"
              className={inputClassName}
              style={DARK_PICKER_STYLE}
              value={checkInTime}
              onChange={(e): void => onCheckInTimeChange(e.target.value)}
            />
          </Field>
          <Field
            label={t("lodging:field.checkOutTime")}
            htmlFor={`${fid}-checkOutTime`}
            hint={t("lodging:field.checkOutTimeHint")}
          >
            <input
              id={`${fid}-checkOutTime`}
              type="time"
              className={inputClassName}
              style={DARK_PICKER_STYLE}
              value={checkOutTime}
              onChange={(e): void => onCheckOutTimeChange(e.target.value)}
            />
          </Field>
        </div>
      )}

      {/* Only asked for where the dates cannot answer it. At DAY precision
          with both ends the dates win anyway, so a field here would be a
          second answer to a settled question. */}
      {datePrecision !== "DAY" && (
        <div className="mt-3">
          <label htmlFor={`${fid}-nights`} className="mb-1 block text-xs text-[var(--text-muted)]">
            {t("lodging:period.nightsField")}
          </label>
          <input
            id={`${fid}-nights`}
            type="number"
            min={0}
            data-testid="stay-nights-input"
            className={inputClassName}
            value={nightsText}
            onChange={(e): void => onNightsChange(e.target.value)}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("lodging:period.nightsHint")}</p>
        </div>
      )}
      {/* Status follows the dates (Alex, Discord 2026-07-12) - the same rule
          2.5.0 applied to flights, cruises and trips. Only the cancellation is
          a human decision, so only it is a control. The derived value is shown
          so the user can see what will be stored rather than having to guess. */}
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] pointer-coarse:min-h-(--ts-size-touch-min)">
          <input
            type="checkbox"
            data-testid="stay-cancelled-toggle"
            checked={isCancelled}
            onChange={(e): void => onCancelledChange(e.target.checked)}
          />
          {t("lodging:stayStatus.cancelled")}
        </label>
        {!isCancelled && (
          <span data-testid="stay-derived-status" className="text-xs text-[var(--text-muted)]">
            {t(`lodging:stayStatus.${derivedStatus}`)}
            {" · "}
            {t("lodging:stayStatus.derivedHint")}
          </span>
        )}
      </div>
      {children}
    </StayEditorSection>
  );
}
