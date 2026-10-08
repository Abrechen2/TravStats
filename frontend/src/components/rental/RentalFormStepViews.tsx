import type { JSX } from "react";
import CurrencySelect from "../common/CurrencySelect";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { useTranslation } from "../../hooks/useTranslation";
import {
  RENTAL_INCLUSIONS,
  type RentalFuelPolicy,
  type RentalPaymentTiming,
} from "../../types/rental";
import { RentalStationPicker } from "./RentalStationPicker";
import { RENTAL_PROVIDER_SUGGESTIONS } from "./rentalProviders";
import {
  RENTAL_LICENSE_PLATE_MAX,
  draftDrivenKm,
  type RentalDraft,
  type RentalFormField,
} from "./rentalFormModel";
import { CHECK_ROW, INPUT_CLASS, Labelled, RentalTimeField, TextInput } from "./rentalFormFields";
import {
  withDayOnly,
  withFold,
  withSameStation,
  withStation,
  withTime,
  zoneOfEnd,
} from "./rentalDraftEdits";
import { rentalFieldId } from "./rentalFormSteps";
import type { RentalTimeEnd } from "./rentalFormTimes";

/** What every step reads and writes — the ONE draft the dialog holds. */
export interface RentalStepProps {
  draft: RentalDraft;
  /** The draft as the dialog opened: a typed-back clock regains its stored occurrence. */
  opened: RentalDraft;
  update: (edit: (d: RentalDraft) => RentalDraft) => void;
  errorOf: (field: RentalFormField) => string | null;
}

const PAYMENT_TIMINGS: RentalPaymentTiming[] = ["prepaid", "pay_at_counter", "package"];
const FUEL_POLICIES: RentalFuelPolicy[] = ["full_to_full", "prepaid_tank", "full_to_empty"];
const PROVIDER_LIST_ID = "rental-provider-suggestions";
const CHIP_CLASS =
  "rounded-full border px-3 py-1 text-xs pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:px-4";

function useSetter(update: RentalStepProps["update"]) {
  return <K extends keyof RentalDraft>(key: K, value: RentalDraft[K]): void =>
    update((d) => ({ ...d, [key]: value }));
}

function EndTime({
  end,
  label,
  required,
  draft,
  opened,
  update,
  errorOf,
}: RentalStepProps & { end: RentalTimeEnd; label: string; required?: boolean }): JSX.Element {
  const field = `${end}Local` as const;
  return (
    <RentalTimeField
      id={rentalFieldId(field)}
      label={label}
      local={draft[field]}
      dayOnly={draft.dayOnly[end]}
      fold={draft.folds[end]}
      zone={zoneOfEnd(draft, end)}
      required={required}
      error={errorOf(field)}
      onLocal={(value): void => update((d) => withTime(d, opened, end, value))}
      onDayOnly={(dayOnly, value): void => update((d) => withDayOnly(d, end, dayOnly, value))}
      onFold={(fold): void => update((d) => withFold(d, end, fold))}
    />
  );
}

/** Step 1 — what was booked: who, where, when, which car, at what price. */
export function RentalBookingStep(props: RentalStepProps): JSX.Element {
  const { draft, update, errorOf } = props;
  const { t } = useTranslation(["rental"]);
  const recentCurrencies = useRecentCurrencies();
  const set = useSetter(update);
  const toggleInclusion = (code: (typeof RENTAL_INCLUSIONS)[number]): void =>
    set(
      "inclusions",
      draft.inclusions.includes(code)
        ? draft.inclusions.filter((c) => c !== code)
        : [...draft.inclusions, code]
    );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Suggestions, not a choice (forgejo#196): any other name is saved as typed. */}
        <TextInput
          id={rentalFieldId("provider")}
          label={t("rental:form.provider")}
          required
          value={draft.provider}
          onChange={(v): void => set("provider", v)}
          error={errorOf("provider")}
          list={PROVIDER_LIST_ID}
          autoComplete="off"
        />
        <datalist id={PROVIDER_LIST_ID} data-testid="rental-provider-suggestions">
          {RENTAL_PROVIDER_SUGGESTIONS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <TextInput
          id="rental-broker"
          label={t("rental:form.broker")}
          value={draft.broker}
          onChange={(v): void => set("broker", v)}
        />
        <TextInput
          id="rental-confirmationNumber"
          label={t("rental:form.confirmationNumber")}
          className="font-mono"
          value={draft.confirmationNumber}
          onChange={(v): void => set("confirmationNumber", v)}
        />
      </div>

      <RentalStationPicker
        label={t("rental:form.pickupStation")}
        idPrefix="rental-pickup"
        required
        value={draft.pickup}
        onChange={(next): void => update((d) => withStation(d, "pickup", next))}
        inputClassName={INPUT_CLASS}
        error={errorOf("pickupStation")}
      />
      <label className={CHECK_ROW}>
        <input
          type="checkbox"
          checked={draft.sameStation}
          onChange={(e): void => update((d) => withSameStation(d, e.target.checked))}
        />
        {t("rental:form.sameStation")}
      </label>
      {!draft.sameStation ? (
        <RentalStationPicker
          label={t("rental:form.returnStation")}
          idPrefix="rental-return"
          required
          value={draft.ret}
          onChange={(next): void => update((d) => withStation(d, "ret", next))}
          inputClassName={INPUT_CLASS}
          error={errorOf("returnStation")}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <EndTime {...props} end="pickup" label={t("rental:form.pickupLocal")} required />
        <EndTime {...props} end="return" label={t("rental:form.returnLocal")} required />
      </div>
      <p className="t-caption">{t("rental:form.stationClockHint")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          id="rental-vehicleClass"
          label={t("rental:form.vehicleClass")}
          value={draft.vehicleClass}
          onChange={(v): void => set("vehicleClass", v)}
        />
        <TextInput
          id={rentalFieldId("acrissCode")}
          label={t("rental:form.acrissCode")}
          className="font-mono uppercase"
          maxLength={4}
          value={draft.acrissCode}
          onChange={(v): void => set("acrissCode", v)}
          error={errorOf("acrissCode")}
        />
        <TextInput
          id="rental-vehicleExample"
          label={t("rental:form.vehicleExample")}
          value={draft.vehicleExample}
          onChange={(v): void => set("vehicleExample", v)}
        />
        <TextInput
          id="rental-arrivalFlightNumber"
          label={t("rental:form.arrivalFlightNumber")}
          className="font-mono uppercase"
          maxLength={12}
          value={draft.arrivalFlightNumber}
          onChange={(v): void => set("arrivalFlightNumber", v)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Labelled id="rental-paymentTiming" label={t("rental:form.paymentTiming")}>
          {(wiring) => (
            <select
              {...wiring}
              className={INPUT_CLASS}
              value={draft.paymentTiming}
              onChange={(e): void =>
                set("paymentTiming", e.target.value as RentalDraft["paymentTiming"])
              }
            >
              <option value="">{t("rental:form.unknown")}</option>
              {PAYMENT_TIMINGS.map((p) => (
                <option key={p} value={p}>
                  {t(`rental:payment.${p}`)}
                </option>
              ))}
            </select>
          )}
        </Labelled>
        <TextInput
          id={rentalFieldId("price")}
          label={t("rental:form.price")}
          inputMode="decimal"
          value={draft.price}
          onChange={(v): void => set("price", v)}
          error={errorOf("price")}
        />
        <Labelled id="rental-currency" label={t("rental:form.currency")}>
          {(wiring) => (
            <CurrencySelect
              id={wiring.id}
              aria-label={t("rental:form.currency")}
              value={draft.currency}
              onChange={(code): void => set("currency", code)}
              recent={recentCurrencies}
              className={INPUT_CLASS}
            />
          )}
        </Labelled>
      </div>

      <Labelled id="rental-fuelPolicy" label={t("rental:form.fuelPolicy")}>
        {(wiring) => (
          <select
            {...wiring}
            className={INPUT_CLASS}
            value={draft.fuelPolicy}
            onChange={(e): void => set("fuelPolicy", e.target.value as RentalDraft["fuelPolicy"])}
          >
            <option value="">{t("rental:form.unknown")}</option>
            {FUEL_POLICIES.map((p) => (
              <option key={p} value={p}>
                {t(`rental:fuel.${p}`)}
              </option>
            ))}
          </select>
        )}
      </Labelled>

      <fieldset className="space-y-2">
        <legend className="text-sm">{t("rental:form.inclusions")}</legend>
        <div className="flex flex-wrap gap-2">
          {RENTAL_INCLUSIONS.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={draft.inclusions.includes(code)}
              onClick={(): void => toggleInclusion(code)}
              className={`${CHIP_CLASS} ${
                draft.inclusions.includes(code)
                  ? "border-(--accent) text-(--accent)"
                  : "border-border"
              }`}
            >
              {t(`rental:inclusion.${code}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <Labelled id="rental-notes" label={t("rental:form.notes")} hint={t("rental:form.notesHint")}>
        {(wiring) => (
          <textarea
            {...wiring}
            className={INPUT_CLASS}
            rows={3}
            value={draft.notes}
            onChange={(e): void => set("notes", e.target.value)}
          />
        )}
      </Labelled>
      <label className={CHECK_ROW}>
        <input
          type="checkbox"
          checked={draft.cancelled}
          onChange={(e): void => set("cancelled", e.target.checked)}
        />
        {t("rental:form.cancelled")}
      </label>
    </div>
  );
}

/** Step 2 — at the counter: when the keys changed hands, the odometer, the car. */
export function RentalPickupStep(props: RentalStepProps): JSX.Element {
  const { draft, update, errorOf } = props;
  const { t } = useTranslation(["rental"]);
  const set = useSetter(update);
  return (
    <div className="space-y-4">
      <p className="t-caption">{t("rental:form.steps.pickupIntro")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <EndTime {...props} end="actualPickup" label={t("rental:form.actualPickupLocal")} />
        <TextInput
          id={rentalFieldId("odometerOutKm")}
          label={t("rental:form.odometerOutKm")}
          inputMode="numeric"
          value={draft.odometerOutKm}
          onChange={(v): void => set("odometerOutKm", v)}
          error={errorOf("odometerOutKm")}
        />
        <TextInput
          id="rental-vehicleDriven"
          label={t("rental:form.vehicleDriven")}
          value={draft.vehicleDriven}
          onChange={(v): void => set("vehicleDriven", v)}
        />
        <TextInput
          id="rental-licensePlate"
          label={t("rental:form.licensePlate")}
          className="font-mono"
          maxLength={RENTAL_LICENSE_PLATE_MAX}
          autoComplete="off"
          value={draft.licensePlate}
          onChange={(v): void => set("licensePlate", v)}
        />
      </div>
    </div>
  );
}

/**
 * Step 3 — the return, leading with what is asked of a person handing back a
 * car: the odometer, the time, then the invoice (forgejo#236).
 */
export function RentalReturnStep(props: RentalStepProps): JSX.Element {
  const { draft, update, errorOf } = props;
  const { t, i18n } = useTranslation(["rental"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const recentCurrencies = useRecentCurrencies();
  const set = useSetter(update);
  // Which figure will count once saved — the rule the list and stats read.
  const driven = draftDrivenKm(draft);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          id={rentalFieldId("odometerInKm")}
          label={t("rental:form.odometerInKm")}
          inputMode="numeric"
          value={draft.odometerInKm}
          onChange={(v): void => set("odometerInKm", v)}
          error={errorOf("odometerInKm")}
        />
        <EndTime {...props} end="actualReturn" label={t("rental:form.actualReturnLocal")} />
      </div>

      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">{t("rental:form.invoice")}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput
            id={rentalFieldId("finalAmount")}
            label={t("rental:form.finalAmount")}
            inputMode="decimal"
            value={draft.finalAmount}
            onChange={(v): void => set("finalAmount", v)}
            error={errorOf("finalAmount")}
          />
          <Labelled id="rental-finalCurrency" label={t("rental:form.finalCurrency")}>
            {(wiring) => (
              <CurrencySelect
                id={wiring.id}
                aria-label={t("rental:form.finalCurrency")}
                value={draft.finalCurrency}
                onChange={(code): void => set("finalCurrency", code)}
                recent={recentCurrencies}
                className={INPUT_CLASS}
              />
            )}
          </Labelled>
          <TextInput
            id="rental-invoiceNumber"
            label={t("rental:form.invoiceNumber")}
            className="font-mono"
            value={draft.invoiceNumber}
            onChange={(v): void => set("invoiceNumber", v)}
          />
        </div>
        <p className="t-caption">{t("rental:form.invoiceHint")}</p>
      </fieldset>

      <TextInput
        id={rentalFieldId("distanceKm")}
        label={t("rental:form.distanceKm")}
        inputMode="numeric"
        value={draft.distanceKm}
        onChange={(v): void => set("distanceKm", v)}
        error={errorOf("distanceKm")}
      />
      <p className="t-caption" data-testid="rental-form-driven" aria-live="polite">
        {driven === null
          ? t("rental:form.drivenUnknown")
          : t("rental:form.driven", {
              km: driven.km.toLocaleString(locale),
              source: t(`rental:distance.${driven.source ?? "unknown"}`),
            })}
      </p>
      <p className="t-caption">{t("rental:form.distanceHint")}</p>
    </div>
  );
}
