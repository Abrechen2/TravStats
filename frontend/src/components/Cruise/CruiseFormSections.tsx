import type { JSX, ReactNode } from "react";
import { minorUnits } from "../../shared/currencies";
import { CRUISE_DISTINCT_PALETTE } from "../../lib/cruiseColor";
import type { CabinType, Trip } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import CurrencySelect from "../common/CurrencySelect";
import CompanionPicker from "../CompanionPicker";
import TagInput from "../TagInput";
import { FieldError, fieldErrorProps } from "../form";
import type { CruiseFieldErrors, CruiseFormFields } from "./cruiseFormDraft";

export type SetCruiseField = <K extends keyof CruiseFormFields>(
  key: K,
  value: CruiseFormFields[K]
) => void;

export const CRUISE_INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3 text-base text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden";
/** A visible name above its field (forgejo#249) — the placeholder was the only one. */
export const CRUISE_LABEL_CLASS = "flex flex-col gap-1 text-xs text-(--text-muted)";

export const CRUISE_DECK_ID = "cruise-form-deck";
export const CRUISE_PRICE_ID = "cruise-form-price";

const CABIN_TYPES: CabinType[] = ["inside", "oceanview", "balcony", "suite"];

// The same distinct hues the map's auto-derive falls back to, so a manual pick
// still looks consistent with un-coloured cruises. Read from the map's own
// palette rather than restated as hex: the two copies carried a "keep both in
// sync" comment and nothing that kept them so.
const toHex = (rgb: readonly number[]): string =>
  `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
const COLOR_PALETTE = CRUISE_DISTINCT_PALETTE.map(toHex);
/** Spoken names of the palette's hues, in its order (review M10: a screen
 *  reader read out each swatch's hex code). */
const COLOR_NAMES = [
  "coral",
  "gold",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
  "ochre",
  "cyan",
  "olive",
] as const;

// 28 px swatches for a mouse, the 44 px minimum for a finger (forgejo#249).
const SWATCH_CLASS = "h-7 w-7 pointer-coarse:h-11 pointer-coarse:w-11";

/** A folding section of the form. `<details>` so the first-error focus can unfold it. */
export function FormSection({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <details open className="mb-4 rounded-md border border-border bg-(--bg-surface)/50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-(--text-primary) pointer-coarse:min-h-(--ts-size-touch-min)">
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function CruiseColorSection({
  color,
  onChange,
}: {
  color: string | null;
  onChange: (color: string | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["cruise"]);
  return (
    <FormSection title={t("detail.mapColor")}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={(): void => onChange(null)}
          aria-label={t("field.colorAuto")}
          aria-pressed={color === null}
          className={`flex items-center justify-center rounded-full border-2 border-dashed text-xs transition-transform hover:scale-110 ${SWATCH_CLASS}`}
          style={{
            borderColor: color === null ? "var(--accent)" : "var(--color-border)",
            color: "var(--text-muted)",
          }}
        >
          ×
        </button>
        {COLOR_PALETTE.map((c, index) => (
          <button
            key={c}
            type="button"
            onClick={(): void => onChange(c)}
            aria-label={t(`colorName.${COLOR_NAMES[index]}`)}
            aria-pressed={color === c}
            className={`rounded-full transition-transform hover:scale-110 ${SWATCH_CLASS}`}
            style={{
              background: c,
              outline: color === c ? `2px solid ${c}` : "none",
              outlineOffset: "2px",
            }}
          />
        ))}
        <input
          type="color"
          aria-label={t("field.color")}
          value={color ?? COLOR_PALETTE[0]}
          onChange={(e): void => onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded-sm border border-border bg-transparent p-0 pointer-coarse:h-11 pointer-coarse:w-14"
        />
      </div>
      {/* Said in words: the dashed swatch's name was only its aria-label. */}
      <p className="mt-2 text-xs text-(--text-muted)">
        {color === null
          ? t("field.colorAuto")
          : t("form.colorPicked", {
              color: COLOR_PALETTE.includes(color.toLowerCase())
                ? t(`colorName.${COLOR_NAMES[COLOR_PALETTE.indexOf(color.toLowerCase())]}`)
                : color,
            })}
      </p>
    </FormSection>
  );
}

export function CruiseCabinSection({
  fields,
  set,
  errors,
}: {
  fields: CruiseFormFields;
  set: SetCruiseField;
  errors: CruiseFieldErrors;
}): JSX.Element {
  const { t } = useTranslation(["cruise"]);
  const deckError = errors.deck ? t(errors.deck) : null;
  return (
    <FormSection title={t("detail.cabin")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className={CRUISE_LABEL_CLASS}>
          {t("field.cabin")}
          <input
            className={CRUISE_INPUT_CLASS}
            value={fields.cabinNumber}
            onChange={(e): void => set("cabinNumber", e.target.value)}
          />
        </label>
        <label className={CRUISE_LABEL_CLASS}>
          {t("field.cabinType")}
          <select
            className={CRUISE_INPUT_CLASS}
            value={fields.cabinType}
            onChange={(e): void => set("cabinType", e.target.value as CabinType | "")}
          >
            <option value="">—</option>
            {CABIN_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`cabinType.${c}`)}
              </option>
            ))}
          </select>
        </label>
        {/* The error sits OUTSIDE the label, or it becomes part of the name. */}
        <div className="flex flex-col gap-1">
          <label className={CRUISE_LABEL_CLASS}>
            {t("field.deck")}
            <input
              id={CRUISE_DECK_ID}
              type="number"
              min={1}
              max={30}
              className={CRUISE_INPUT_CLASS}
              value={fields.deck}
              onChange={(e): void => set("deck", e.target.value)}
              {...fieldErrorProps(CRUISE_DECK_ID, deckError)}
            />
          </label>
          <FieldError id={CRUISE_DECK_ID} error={deckError} />
        </div>
      </div>
    </FormSection>
  );
}

export function CruiseCostsSection({
  fields,
  set,
  errors,
}: {
  fields: CruiseFormFields;
  set: SetCruiseField;
  errors: CruiseFieldErrors;
}): JSX.Element {
  const { t } = useTranslation(["cruise"]);
  const recentCurrencies = useRecentCurrencies();
  const priceError = errors.price ? t(errors.price) : null;
  return (
    <FormSection title={t("detail.costs")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className={CRUISE_LABEL_CLASS}>
          {t("field.bookingReference")}
          <input
            className={CRUISE_INPUT_CLASS}
            value={fields.bookingReference}
            onChange={(e): void => set("bookingReference", e.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <label className={CRUISE_LABEL_CLASS}>
            {t("field.price")}
            <input
              id={CRUISE_PRICE_ID}
              type="number"
              min={0}
              step={10 ** -minorUnits(fields.currency)}
              className={CRUISE_INPUT_CLASS}
              value={fields.price}
              onChange={(e): void => set("price", e.target.value)}
              {...fieldErrorProps(CRUISE_PRICE_ID, priceError)}
            />
          </label>
          <FieldError id={CRUISE_PRICE_ID} error={priceError} />
        </div>
        <div className={CRUISE_LABEL_CLASS}>
          <label htmlFor="cruise-form-currency">{t("field.currency")}</label>
          <CurrencySelect
            id="cruise-form-currency"
            aria-label={t("field.currency")}
            value={fields.currency}
            recent={recentCurrencies}
            onChange={(code): void => set("currency", code)}
          />
        </div>
      </div>
    </FormSection>
  );
}

export function CruiseMetaSection({
  fields,
  set,
  trips,
  onPickTrip,
}: {
  fields: CruiseFormFields;
  set: SetCruiseField;
  trips: readonly Trip[];
  onPickTrip: (tripId: string) => void;
}): JSX.Element {
  const { t } = useTranslation(["cruise"]);
  return (
    <FormSection title={t("detail.meta")}>
      <div className={CRUISE_LABEL_CLASS}>
        <label htmlFor="cruise-form-tags">{t("field.tags")}</label>
        <TagInput
          id="cruise-form-tags"
          className={CRUISE_INPUT_CLASS}
          value={fields.tags}
          onChange={(tags): void => set("tags", tags)}
        />
      </div>
      <div className="mt-3">
        <span className="label">{t("field.companions")}</span>
        <CompanionPicker
          value={fields.companions}
          onChange={(companions): void => set("companions", companions)}
        />
      </div>
      <div className="mt-3">
        <label className="label" htmlFor="cruise-edit-trip">
          {t("field.trip")}
        </label>
        <select
          id="cruise-edit-trip"
          className={CRUISE_INPUT_CLASS}
          value={fields.tripId}
          onChange={(e): void => onPickTrip(e.target.value)}
        >
          <option value="">{t("field.noTrip")}</option>
          {trips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.name}
            </option>
          ))}
        </select>
      </div>
      <label className={`mt-3 ${CRUISE_LABEL_CLASS}`}>
        {t("field.notes")}
        <textarea
          rows={3}
          className={CRUISE_INPUT_CLASS}
          value={fields.notes}
          onChange={(e): void => set("notes", e.target.value)}
        />
      </label>
    </FormSection>
  );
}
