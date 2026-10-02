import { useState } from "react";
import type { JSX, ReactNode } from "react";
import Modal from "../Modal";
import CurrencySelect from "../common/CurrencySelect";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { useTranslation } from "../../hooks/useTranslation";
import { rentalApi } from "../../lib/api/rental";
import { logger } from "../../lib/logger";
import {
  RENTAL_INCLUSIONS,
  type RentalBooking,
  type RentalPaymentTiming,
} from "../../types/rental";
import { RentalStationPicker } from "./RentalStationPicker";
import {
  EMPTY_RENTAL_DRAFT,
  draftFromRental,
  rentalInputFromDraft,
  rentalSaveError,
  validateRentalDraft,
  type RentalDraft,
  type RentalSaveError,
} from "./rentalFormModel";

interface Props {
  rental: RentalBooking | null;
  onClose: () => void;
  onSaved: (saved: RentalBooking) => void | Promise<void>;
}

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3 text-base text-(--text-primary) placeholder:text-(--text-muted) focus:border-(--accent) focus:outline-hidden";
const DARK_PICKER_STYLE = { colorScheme: "dark" } as const;
const PAYMENT_TIMINGS: RentalPaymentTiming[] = ["prepaid", "pay_at_counter", "package"];

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      {children}
      {error ? (
        <span role="alert" className="block text-xs text-(--danger)">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Manual entry of a rental (spec 2026-10-01-rental-domain-design §6, R1).
 * Times are typed on each STATION's clock; the server places the station and
 * reads the clock in its zone (ADR 0002). Kilometres and the final amount
 * belong to the invoice — the km field here is a labelled correction, said so
 * beside it. A failed save shows the refusal's own sentence and leaves the
 * dialog open (silent-failure class 3).
 */
export function RentalFormModal({ rental, onClose, onSaved }: Props): JSX.Element {
  const { t } = useTranslation(["rental", "common"]);
  const recentCurrencies = useRecentCurrencies();
  const [draft, setDraft] = useState<RentalDraft>(
    rental ? draftFromRental(rental) : EMPTY_RENTAL_DRAFT
  );
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<RentalSaveError | null>(null);
  const errors = validateRentalDraft(draft);
  const ready = Object.keys(errors).length === 0;
  const set = <K extends keyof RentalDraft>(key: K, value: RentalDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));
  const fieldError = (field: keyof typeof errors): string | null => {
    if (error?.field === field) return t(error.key);
    return touched && errors[field] ? t(errors[field] as string) : null;
  };

  const submit = async (): Promise<void> => {
    setTouched(true);
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const input = rentalInputFromDraft(draft);
      const saved = rental
        ? await rentalApi.update(rental.id, input)
        : await rentalApi.create(input);
      await onSaved(saved);
    } catch (err: unknown) {
      logger.error("RentalFormModal: save failed", err);
      setError(rentalSaveError(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleInclusion = (code: (typeof RENTAL_INCLUSIONS)[number]): void =>
    set(
      "inclusions",
      draft.inclusions.includes(code)
        ? draft.inclusions.filter((c) => c !== code)
        : [...draft.inclusions, code]
    );

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      closeLabel={t("common:buttons.close")}
      title={rental ? t("rental:form.editTitle") : t("rental:form.createTitle")}
      maxWidth={672}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50"
          >
            {t("rental:form.cancel")}
          </button>
          <button
            type="button"
            onClick={(): void => void submit()}
            disabled={saving}
            className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
          >
            {saving ? t("rental:form.saving") : t("rental:form.save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && error.field === null ? (
          <p
            role="alert"
            className="rounded-md border border-(--danger) p-2 text-sm text-(--danger)"
          >
            {t(error.key)}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("rental:form.provider")} error={fieldError("provider")}>
            <input
              className={INPUT_CLASS}
              value={draft.provider}
              onChange={(e) => set("provider", e.target.value)}
            />
          </Field>
          <Field label={t("rental:form.broker")}>
            <input
              className={INPUT_CLASS}
              value={draft.broker}
              onChange={(e) => set("broker", e.target.value)}
            />
          </Field>
          <Field label={t("rental:form.confirmationNumber")}>
            <input
              className={`${INPUT_CLASS} font-mono`}
              value={draft.confirmationNumber}
              onChange={(e) => set("confirmationNumber", e.target.value)}
            />
          </Field>
        </div>

        <RentalStationPicker
          label={t("rental:form.pickupStation")}
          idPrefix="rental-pickup"
          value={draft.pickup}
          onChange={(next) => set("pickup", next)}
          inputClassName={INPUT_CLASS}
          error={fieldError("pickupStation")}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.sameStation}
            onChange={(e) => set("sameStation", e.target.checked)}
          />
          {t("rental:form.sameStation")}
        </label>
        {!draft.sameStation ? (
          <RentalStationPicker
            label={t("rental:form.returnStation")}
            idPrefix="rental-return"
            value={draft.ret}
            onChange={(next) => set("ret", next)}
            inputClassName={INPUT_CLASS}
            error={fieldError("returnStation")}
          />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("rental:form.pickupLocal")} error={fieldError("pickupLocal")}>
            <input
              type="datetime-local"
              style={DARK_PICKER_STYLE}
              className={INPUT_CLASS}
              value={draft.pickupLocal}
              onChange={(e) => set("pickupLocal", e.target.value)}
            />
          </Field>
          <Field label={t("rental:form.returnLocal")} error={fieldError("returnLocal")}>
            <input
              type="datetime-local"
              style={DARK_PICKER_STYLE}
              className={INPUT_CLASS}
              value={draft.returnLocal}
              onChange={(e) => set("returnLocal", e.target.value)}
            />
          </Field>
        </div>
        <p className="t-caption">{t("rental:form.stationClockHint")}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("rental:form.vehicleClass")}>
            <input
              className={INPUT_CLASS}
              value={draft.vehicleClass}
              onChange={(e) => set("vehicleClass", e.target.value)}
            />
          </Field>
          <Field label={t("rental:form.acrissCode")} error={fieldError("acrissCode")}>
            <input
              className={`${INPUT_CLASS} font-mono uppercase`}
              maxLength={4}
              value={draft.acrissCode}
              onChange={(e) => set("acrissCode", e.target.value)}
            />
          </Field>
          <Field label={t("rental:form.vehicleExample")}>
            <input
              className={INPUT_CLASS}
              value={draft.vehicleExample}
              onChange={(e) => set("vehicleExample", e.target.value)}
            />
          </Field>
          <Field label={t("rental:form.vehicleDriven")}>
            <input
              className={INPUT_CLASS}
              value={draft.vehicleDriven}
              onChange={(e) => set("vehicleDriven", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("rental:form.paymentTiming")}>
            <select
              className={INPUT_CLASS}
              value={draft.paymentTiming}
              onChange={(e) => set("paymentTiming", e.target.value as RentalDraft["paymentTiming"])}
            >
              <option value="">{t("rental:form.unknown")}</option>
              {PAYMENT_TIMINGS.map((p) => (
                <option key={p} value={p}>
                  {t(`rental:payment.${p}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("rental:form.price")} error={fieldError("price")}>
            <input
              inputMode="decimal"
              className={INPUT_CLASS}
              value={draft.price}
              onChange={(e) => set("price", e.target.value)}
            />
          </Field>
          <Field label={t("rental:form.currency")}>
            <CurrencySelect
              value={draft.currency}
              onChange={(code) => set("currency", code)}
              recent={recentCurrencies}
              className={INPUT_CLASS}
              aria-label={t("rental:form.currency")}
            />
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm">{t("rental:form.inclusions")}</legend>
          <div className="flex flex-wrap gap-2">
            {RENTAL_INCLUSIONS.map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={draft.inclusions.includes(code)}
                onClick={() => toggleInclusion(code)}
                className={`rounded-full border px-3 py-1 text-xs ${
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

        <Field label={t("rental:form.distanceKm")} error={fieldError("distanceKm")}>
          <input
            inputMode="numeric"
            className={INPUT_CLASS}
            value={draft.distanceKm}
            onChange={(e) => set("distanceKm", e.target.value)}
          />
        </Field>
        <p className="t-caption">{t("rental:form.distanceHint")}</p>

        <Field label={t("rental:form.notes")}>
          <textarea
            className={INPUT_CLASS}
            rows={3}
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.cancelled}
            onChange={(e) => set("cancelled", e.target.checked)}
          />
          {t("rental:form.cancelled")}
        </label>
      </div>
    </Modal>
  );
}
