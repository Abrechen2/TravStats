import type { JSX } from "react";
import CurrencySelect from "../common/CurrencySelect";
import SuggestionChips from "../common/SuggestionChips";
import TagInput from "../TagInput";
import CompanionPicker from "../CompanionPicker";
import { FieldError, fieldErrorProps } from "../form";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { useTranslation } from "../../hooks/useTranslation";
import { minorUnits } from "../../shared/currencies";
import type { Trip } from "../../types";
import { INPUT_CLASS, LabelledInput, type BusFieldErrorFor } from "./busFormFields";
import { busFieldId, type BusFormDraft } from "./busFormModel";

interface Props {
  draft: BusFormDraft;
  set: <K extends keyof BusFormDraft>(key: K, value: BusFormDraft[K]) => void;
  fareClasses: readonly string[];
  trips: readonly Trip[];
  pickTrip: (tripId: string) => void;
  errorFor: BusFieldErrorFor;
}

/**
 * The bus form's lower half — ticket, price, people, trip and notes — moved out
 * of the dialog so the dialog keeps the rules (times, terminals, save) and
 * this keeps the plain fields. Every field here has a visible label
 * (forgejo#249) and shows a refusal that names it at the field (forgejo#246).
 */
export function BusFormDetails({
  draft,
  set,
  fareClasses,
  trips,
  pickTrip,
  errorFor,
}: Props): JSX.Element {
  const { t } = useTranslation(["bus"]);
  const recentCurrencies = useRecentCurrencies();
  const tripId = busFieldId("tripId");
  const notesId = busFieldId("notes");
  const currencyId = "bus-currency";
  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <LabelledInput
            label={t("bus:form.class")}
            field="fareClass"
            error={errorFor("fareClass")}
            placeholder={t("bus:form.classPlaceholder")}
            value={draft.fareClass}
            onChange={(e): void => set("fareClass", e.target.value)}
          />
          <SuggestionChips
            value={draft.fareClass}
            suggestions={[...fareClasses]}
            onPick={(value): void => set("fareClass", value)}
            fieldLabel={t("bus:form.class")}
          />
        </div>
        <LabelledInput
          label={t("bus:form.seatNumber")}
          field="seat"
          error={errorFor("seat")}
          value={draft.seat}
          onChange={(e): void => set("seat", e.target.value)}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LabelledInput
          label={t("bus:form.bookingReference")}
          field="bookingReference"
          error={errorFor("bookingReference")}
          value={draft.bookingReference}
          onChange={(e): void => set("bookingReference", e.target.value)}
        />
        <LabelledInput
          label={t("bus:form.price")}
          field="price"
          error={errorFor("price")}
          type="number"
          min={0}
          step={10 ** -minorUnits(draft.currency)}
          value={draft.price}
          onChange={(e): void => set("price", e.target.value)}
        />
        <div>
          <label htmlFor={currencyId} className="block text-sm">
            {t("bus:form.currency")}
          </label>
          <div className="mt-1">
            <CurrencySelect
              id={currencyId}
              aria-label={t("bus:form.currency")}
              value={draft.currency}
              recent={recentCurrencies}
              onChange={(code): void => set("currency", code)}
            />
          </div>
        </div>
      </div>

      <div className="mb-4">
        {/* TagInput is a composite: its text box carries the name, the
            visible line above says the same. */}
        <span className="block text-sm">{t("bus:form.tags")}</span>
        <div className="mt-1">
          <TagInput
            ariaLabel={t("bus:form.tags")}
            className={INPUT_CLASS}
            value={draft.tags}
            onChange={(next): void => set("tags", next)}
          />
        </div>
        <div className="mt-3">
          <span className="label">{t("bus:form.companions")}</span>
          <CompanionPicker
            value={draft.companions}
            onChange={(next): void => set("companions", next)}
          />
        </div>
        <label className="mt-3 block text-sm">
          {t("bus:form.trip")}
          <select
            id={tripId}
            className={`mt-1 ${INPUT_CLASS}`}
            value={draft.tripId}
            onChange={(e): void => pickTrip(e.target.value)}
            {...fieldErrorProps(tripId, errorFor("tripId"))}
          >
            <option value="">{t("bus:form.tripNone")}</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>
        </label>
        <FieldError id={tripId} error={errorFor("tripId")} />
        <label className="mt-3 block text-sm">
          {t("bus:form.notes")}
          <textarea
            id={notesId}
            rows={3}
            className={`mt-1 ${INPUT_CLASS}`}
            value={draft.notes}
            onChange={(e): void => set("notes", e.target.value)}
            {...fieldErrorProps(notesId, errorFor("notes"))}
          />
        </label>
        <FieldError id={notesId} error={errorFor("notes")} />
      </div>
    </>
  );
}
