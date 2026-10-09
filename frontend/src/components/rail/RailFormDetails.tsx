import type { JSX } from "react";
import CurrencySelect from "../common/CurrencySelect";
import SuggestionChips from "../common/SuggestionChips";
import CompanionPicker from "../CompanionPicker";
import TagInput from "../TagInput";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { useTranslation } from "../../hooks/useTranslation";
import { minorUnits } from "../../shared/currencies";
import type { Trip } from "../../types";
import {
  RAIL_TRAVEL_CLASSES,
  type RailEntrySuggestions,
  type RailTravelClass,
} from "../../types/rail";
import type { RailFormDraft } from "./railFormModel";
import { FieldError, fieldErrorProps } from "../form";
import { railFieldId } from "./railFormModel";
import { INPUT_CLASS, LabelledInput, Section, type RailFieldErrorFor } from "./railFormFields";

interface Props {
  draft: RailFormDraft;
  set: <K extends keyof RailFormDraft>(key: K, value: RailFormDraft[K]) => void;
  suggestions: Pick<RailEntrySuggestions, "travelClass" | "coaches" | "seats">;
  trips: Trip[];
  pickTrip: (tripId: string) => void;
  /** A refusal naming one of these fields, shown at it (forgejo#246). */
  errorFor: RailFieldErrorFor;
}

/**
 * The rail form's seat, booking and companion sections — split out of
 * `RailFormModal` to keep it under the file-size limit. Every field has a
 * label that stays visible once typed into (forgejo#249): a placeholder
 * alone vanishes the moment it is needed.
 */
export function RailFormDetails({
  draft,
  set,
  suggestions,
  trips,
  pickTrip,
  errorFor,
}: Props): JSX.Element {
  const { t } = useTranslation(["rail", "common"]);
  const recentCurrencies = useRecentCurrencies();
  return (
    <>
      <Section title={t("rail:form.seat")}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-sm" htmlFor={railFieldId("travelClass")}>
              {t("rail:form.class")}
            </label>
            <select
              id={railFieldId("travelClass")}
              {...fieldErrorProps(railFieldId("travelClass"), errorFor("travelClass"))}
              className={`mt-1 ${INPUT_CLASS}`}
              value={draft.travelClass}
              onChange={(e): void => set("travelClass", e.target.value as RailTravelClass | "")}
            >
              <option value="">{t("rail:form.class")}</option>
              {RAIL_TRAVEL_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {t(`rail:class.${c}`)}
                </option>
              ))}
            </select>
            <FieldError id={railFieldId("travelClass")} error={errorFor("travelClass")} />
            {/* Offered only while no class is chosen — a chip never
              overrides a value the user set. */}
            {draft.travelClass === "" && suggestions.travelClass !== null && (
              <SuggestionChips
                value=""
                suggestions={[t(`rail:class.${suggestions.travelClass}`)]}
                onPick={(): void => set("travelClass", suggestions.travelClass ?? "")}
                fieldLabel={t("rail:form.class")}
              />
            )}
          </div>
          <div>
            <LabelledInput
              label={t("rail:form.coach")}
              field="coach"
              error={errorFor("coach")}
              value={draft.coach}
              onChange={(e): void => set("coach", e.target.value)}
            />
            <SuggestionChips
              value={draft.coach}
              suggestions={suggestions.coaches}
              onPick={(value): void => set("coach", value)}
              fieldLabel={t("rail:form.coach")}
            />
          </div>
          <div>
            <LabelledInput
              label={t("rail:form.seatNumber")}
              field="seat"
              error={errorFor("seat")}
              value={draft.seat}
              onChange={(e): void => set("seat", e.target.value)}
            />
            <SuggestionChips
              value={draft.seat}
              suggestions={suggestions.seats}
              onPick={(value): void => set("seat", value)}
              fieldLabel={t("rail:form.seatNumber")}
            />
          </div>
        </div>
      </Section>

      <Section title={t("rail:form.costs")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LabelledInput
            label={t("rail:form.bookingReference")}
            field="bookingReference"
            error={errorFor("bookingReference")}
            value={draft.bookingReference}
            onChange={(e): void => set("bookingReference", e.target.value)}
          />
          <LabelledInput
            label={t("rail:form.price")}
            field="price"
            error={errorFor("price")}
            type="number"
            min={0}
            step={10 ** -minorUnits(draft.currency)}
            value={draft.price}
            onChange={(e): void => set("price", e.target.value)}
          />
          {/* A custom control: the visible text names it, the aria-label
            carries the same words to a screen reader. */}
          <div>
            <span className="block text-sm" aria-hidden="true">
              {t("rail:form.currency")}
            </span>
            <div className="mt-1">
              <CurrencySelect
                aria-label={t("rail:form.currency")}
                value={draft.currency}
                recent={recentCurrencies}
                onChange={(code): void => set("currency", code)}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section title={t("rail:form.meta")}>
        <span className="block text-sm" aria-hidden="true">
          {t("rail:form.tags")}
        </span>
        <TagInput
          ariaLabel={t("rail:form.tags")}
          className={INPUT_CLASS}
          placeholder={t("rail:form.tags")}
          value={draft.tags}
          onChange={(next): void => set("tags", next)}
        />
        <div className="mt-3">
          <span className="label">{t("rail:form.companions")}</span>
          <CompanionPicker
            value={draft.companions}
            onChange={(next): void => set("companions", next)}
          />
        </div>
        <label className="mt-3 block text-sm">
          {t("rail:form.trip")}
          <select
            id={railFieldId("tripId")}
            {...fieldErrorProps(railFieldId("tripId"), errorFor("tripId"))}
            className={`mt-1 ${INPUT_CLASS}`}
            value={draft.tripId}
            onChange={(e): void => pickTrip(e.target.value)}
          >
            <option value="">{t("rail:form.noTrip")}</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>
        </label>
        <FieldError id={railFieldId("tripId")} error={errorFor("tripId")} />
        <label className="mt-3 block text-sm">
          {t("rail:form.notes")}
          <textarea
            id={railFieldId("notes")}
            {...fieldErrorProps(railFieldId("notes"), errorFor("notes"))}
            rows={3}
            className={`mt-1 ${INPUT_CLASS}`}
            value={draft.notes}
            onChange={(e): void => set("notes", e.target.value)}
          />
        </label>
        <FieldError id={railFieldId("notes")} error={errorFor("notes")} />
      </Section>
    </>
  );
}
