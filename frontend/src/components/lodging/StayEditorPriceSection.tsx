import type { JSX } from "react";
import { useLodgingFxPreview } from "../../hooks/useLodgingFxPreview";
import { formatStayPriceDisplay } from "../../lib/lodgingFormat";
import type { LodgingCurrency } from "../../types/lodging";

const CURRENCIES: LodgingCurrency[] = ["EUR", "USD", "GBP", "CHF"];

interface StayEditorPriceSectionProps {
  totalPrice: string;
  onTotalPriceChange: (v: string) => void;
  pricePerNight: string;
  onPricePerNightChange: (v: string) => void;
  currency: LodgingCurrency;
  onCurrencyChange: (v: LodgingCurrency) => void;
  isAwardStay: boolean;
  onAwardStayChange: (v: boolean) => void;
  /** Check-in as "YYYY-MM-DD" (the calendar day the ECB rate snapshots against), or "" while unset. */
  checkInDate: string;
  baseCurrency: string;
  language: string | undefined;
  t: (key: string, options?: Record<string, unknown>) => string;
  inputClassName: string;
}

/**
 * Price + currency + the award-stay toggle + the live FX readout.
 *
 * The FX readout (`X CUR → Y BASE · rate · date`) is a PREVIEW ONLY, built
 * from `useLodgingFxPreview` (a debounced, same-origin GET) and rendered via
 * the exact same `formatStayPriceDisplay` helper `LodgingStayCard` uses for
 * the persisted snapshot — so a saved stay and this live preview never drift
 * in formatting. The real, authoritative snapshot is computed server-side at
 * save time (`applyFxSnapshot`); this component never feeds a value back
 * into that write.
 */
export function StayEditorPriceSection({
  totalPrice,
  onTotalPriceChange,
  pricePerNight,
  onPricePerNightChange,
  currency,
  onCurrencyChange,
  isAwardStay,
  onAwardStayChange,
  checkInDate,
  baseCurrency,
  language,
  t,
  inputClassName,
}: StayEditorPriceSectionProps): JSX.Element {
  const parsedTotalPrice = totalPrice.trim().length > 0 ? Number.parseFloat(totalPrice) : null;
  const preview = useLodgingFxPreview({
    totalPrice: parsedTotalPrice,
    currency,
    checkInDate,
    baseCurrency,
  });

  const { fxReadout } = formatStayPriceDisplay(
    {
      totalPrice: parsedTotalPrice,
      currency,
      totalPriceBase: preview?.baseAmount ?? null,
      fxRate: preview?.rate ?? null,
      fxRateDate: preview?.rateDate ?? null,
      fxBaseCurrency: preview?.baseCurrency ?? null,
    },
    language,
    t("lodging:fx.source"),
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <input
          type="number"
          min={0}
          step={0.01}
          aria-label={t("lodging:field.totalPrice")}
          className={inputClassName}
          value={totalPrice}
          onChange={(e): void => onTotalPriceChange(e.target.value)}
          placeholder={t("lodging:field.totalPrice")}
        />
        <input
          type="number"
          min={0}
          step={0.01}
          aria-label={t("lodging:field.pricePerNight")}
          className={inputClassName}
          value={pricePerNight}
          onChange={(e): void => onPricePerNightChange(e.target.value)}
          placeholder={t("lodging:field.pricePerNight")}
        />
        <select
          aria-label={t("lodging:field.currency")}
          className={inputClassName}
          value={currency}
          onChange={(e): void => onCurrencyChange(e.target.value as LodgingCurrency)}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
        <input
          type="checkbox"
          data-testid="award-stay-toggle"
          checked={isAwardStay}
          onChange={(e): void => onAwardStayChange(e.target.checked)}
        />
        {t("lodging:field.awardStay")}
      </label>

      {fxReadout !== null && (
        <p
          data-testid="stay-editor-fx-readout"
          className="text-xs"
          style={{ color: "var(--fx,#6ab7d8)" }}
          title={t("lodging:fx.tooltip")}
        >
          {fxReadout}
        </p>
      )}
    </div>
  );
}
