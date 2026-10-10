import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import type { RailImportBooking, RailTravelClass } from "../../types/rail";
import { RAIL_TRAVEL_CLASSES } from "../../types/rail";
import {
  BOOKING_REFERENCE_MAX,
  OPERATOR_MAX,
  draftProblems,
  isEdited,
  unreadFields,
  type BookingField,
  type RailBookingDraft,
} from "./railImportBookingDraft";

interface Props {
  booking: RailImportBooking;
  draft: RailBookingDraft;
  onChange: (patch: Partial<RailBookingDraft>) => void;
  /** No leg of this booking will carry the total (one is already logged). */
  totalNotWritten: boolean;
  disabled: boolean;
}

/**
 * The booking-wide facts of a rail import, correctable before saving
 * (forgejo#161). Each says whether the document carried it, and a changed one
 * says that it was changed — so a gap is visible as a gap, never a dash that
 * reads like "none".
 */
export function RailImportBookingFields({
  booking,
  draft,
  onChange,
  totalNotWritten,
  disabled,
}: Props): JSX.Element {
  const { t } = useTranslation(["rail"]);
  const coarse = useCoarsePointer();
  const unread = unreadFields(booking);
  const problems = draftProblems(draft);
  const inputClass = `w-full rounded-md border border-border bg-(--bg-surface) px-3 text-sm text-(--text-primary) ${
    coarse ? "min-h-11 py-2" : "py-1.5"
  }`;

  const status = (field: BookingField): JSX.Element | null => {
    if (isEdited(booking, draft, field)) {
      return (
        <span className="t-caption" data-testid={`rail-import-edited-${field}`}>
          {t("rail:import.booking.edited")}
        </span>
      );
    }
    if (unread.includes(field)) {
      return (
        <span className="t-caption text-(--warning)" data-testid={`rail-import-unread-${field}`}>
          {t("rail:import.booking.notRecognised")}
        </span>
      );
    }
    return null;
  };

  return (
    <section className="mb-3 flex flex-col gap-3" data-testid="rail-import-booking">
      <p className="t-caption">{t("rail:import.booking.appliesToAll")}</p>
      {unread.length > 0 && (
        <p className="text-sm text-(--warning)" data-testid="rail-import-incomplete">
          {t("rail:import.booking.incomplete")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id="rail-import-operator"
          label={t("rail:form.operator")}
          status={status("operator")}
        >
          <input
            id="rail-import-operator"
            className={inputClass}
            value={draft.operator}
            maxLength={OPERATOR_MAX}
            disabled={disabled}
            onChange={(e): void => onChange({ operator: e.target.value })}
          />
        </Field>
        <Field
          id="rail-import-reference"
          label={t("rail:form.bookingReference")}
          status={status("bookingReference")}
        >
          <input
            id="rail-import-reference"
            className={inputClass}
            value={draft.bookingReference}
            maxLength={BOOKING_REFERENCE_MAX}
            disabled={disabled}
            onChange={(e): void => onChange({ bookingReference: e.target.value })}
          />
        </Field>
        <Field id="rail-import-class" label={t("rail:form.class")} status={status("travelClass")}>
          <select
            id="rail-import-class"
            className={inputClass}
            value={draft.travelClass}
            disabled={disabled}
            onChange={(e): void =>
              onChange({ travelClass: e.target.value as RailTravelClass | "" })
            }
          >
            <option value="">{t("rail:import.booking.noClass")}</option>
            {RAIL_TRAVEL_CLASSES.map((c) => (
              <option key={c} value={c}>
                {t(`rail:class.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="rail-import-price" label={t("rail:import.total")} status={status("price")}>
          <div className="flex gap-2">
            <input
              id="rail-import-price"
              className={inputClass}
              value={draft.price}
              inputMode="decimal"
              disabled={disabled}
              aria-invalid={problems.includes("price")}
              onChange={(e): void => onChange({ price: e.target.value })}
            />
            <input
              aria-label={t("rail:form.currency")}
              className={`${inputClass} w-20 uppercase`}
              value={draft.currency}
              maxLength={3}
              disabled={disabled}
              aria-invalid={problems.includes("currency")}
              onChange={(e): void => onChange({ currency: e.target.value.toUpperCase() })}
            />
          </div>
          {totalNotWritten && draft.price.trim() !== "" && (
            <span className="t-caption">{t("rail:import.totalNotWritten")}</span>
          )}
        </Field>
        {booking.tariff && (
          <p className="text-sm sm:col-span-2">
            <span className="text-(--text-muted)">{t("rail:import.tariff")}: </span>
            {booking.tariff}
          </p>
        )}
      </div>
      {problems.map((p) => (
        <p
          key={p}
          role="alert"
          className="text-sm text-(--danger)"
          data-testid={`rail-import-problem-${p}`}
        >
          {t(`rail:import.booking.problem.${p}`)}
        </p>
      ))}
    </section>
  );
}

function Field({
  id,
  label,
  status,
  children,
}: {
  id: string;
  label: string;
  status: JSX.Element | null;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-(--text-muted)">
        {label}
      </label>
      {children}
      {status}
    </div>
  );
}
