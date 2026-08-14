import { minorUnits } from "../../shared/currencies";
import type { JSX } from "react";
import CurrencySelect from "../common/CurrencySelect";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { useLodgingFxPreview } from "../../hooks/useLodgingFxPreview";
import { formatDayForLocale, formatStayPriceDisplay } from "../../lib/lodgingFormat";
import { formatCurrency } from "../../lib/units";
import type { LodgingCurrency } from "../../types/lodging";

interface StayEditorPriceSectionProps {
  totalPrice: string;
  onTotalPriceChange: (v: string) => void;
  /** Derived from total ÷ nights — displayed, never typed. Null when unknown. */
  pricePerNight: number | null;
  /** Label for the derived per-night figure. */
  pricePerNightLabel: string;
  currency: LodgingCurrency;
  onCurrencyChange: (v: LodgingCurrency) => void;
  isAwardStay: boolean;
  /** The rate the user typed for a currency/day no provider covers, as text. */
  manualFxRate?: string;
  onManualFxRateChange?: (v: string) => void;
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
  pricePerNightLabel,
  currency,
  onCurrencyChange,
  isAwardStay,
  manualFxRate = "",
  onManualFxRateChange,
  onAwardStayChange,
  checkInDate,
  baseCurrency,
  language,
  t,
  inputClassName,
}: StayEditorPriceSectionProps): JSX.Element {
  const recentCurrencies = useRecentCurrencies();
  const parsedTotalPrice = totalPrice.trim().length > 0 ? Number.parseFloat(totalPrice) : null;
  const preview = useLodgingFxPreview({
    totalPrice: parsedTotalPrice,
    currency,
    checkInDate,
    baseCurrency,
  });

  // The row only appears where it is USEFUL: there is a price, the currency
  // differs from the base, and no provider had a rate for that day. Offering
  // it otherwise would invite someone to overwrite the ECB by hand.
  const needsManualRate =
    onManualFxRateChange !== undefined &&
    parsedTotalPrice !== null &&
    currency !== baseCurrency &&
    preview === null;
  const parsedManualRate = manualFxRate.trim().length > 0 ? Number.parseFloat(manualFxRate) : null;
  const manualPreview =
    parsedManualRate !== null &&
    Number.isFinite(parsedManualRate) &&
    parsedManualRate > 0 &&
    parsedTotalPrice !== null
      ? `${formatCurrency(parsedTotalPrice, currency)} → ${formatCurrency(Math.round(parsedTotalPrice * parsedManualRate * 100) / 100, baseCurrency)}`
      : null;

  const { fxReadout, marker } = formatStayPriceDisplay(
    {
      totalPrice: parsedTotalPrice,
      currency,
      totalPriceBase: preview?.baseAmount ?? null,
      fxRate: preview?.rate ?? null,
      fxRateDate: preview?.rateDate ?? null,
      fxBaseCurrency: preview?.baseCurrency ?? null,
      // The preview must name the SAME source the saved stay will, or the
      // editor promises an ECB rate the card then contradicts.
      fxSource: preview?.source ?? null,
    },
    language,
    {
      ecb: t("lodging:fx.source"),

      market: t("lodging:fx.sourceMarket"),

      manual: t("lodging:fx.markerManual"),

      none: t("lodging:fx.markerNone"),
    }
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <input
          type="number"
          min={0}
          step={10 ** -minorUnits(currency)}
          aria-label={t("lodging:field.totalPrice")}
          className={inputClassName}
          value={totalPrice}
          onChange={(e): void => onTotalPriceChange(e.target.value)}
          placeholder={t("lodging:field.totalPrice")}
        />
        {/* Derived, not typed (Alex, 2026-07-12): a hand-entered per-night
            price is a second number that can silently contradict the total.
            Rendered as a read-only figure so the user sees the arithmetic
            happen rather than having to repeat it. */}
        <div
          data-testid="stay-editor-price-per-night"
          className="flex flex-col justify-center rounded-md border border-(--color-border) bg-(--bg-base) px-3 py-1"
        >
          <span className="text-[10px] text-(--text-muted)">{pricePerNightLabel}</span>
          <span className="text-sm text-(--text-primary)">
            {pricePerNight !== null ? formatCurrency(pricePerNight, currency) : "—"}
          </span>
        </div>
        <CurrencySelect
          aria-label={t("lodging:field.currency")}
          value={currency}
          recent={recentCurrencies}
          onChange={(code): void => onCurrencyChange(code as LodgingCurrency)}
        />
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

      {marker !== null && (
        <span
          data-testid="stay-editor-fx-marker"
          className="inline-block rounded border border-[var(--border)] px-1 py-px text-[10px] text-[var(--text-muted)]"
        >
          {marker}
        </span>
      )}

      {needsManualRate && (
        <div data-testid="stay-editor-manual-rate" className="space-y-1">
          <p className="text-xs text-[var(--text-muted)]">
            {t("lodging:fx.noRateHint", {
              currency,
              // The day the user reads, not the day the API speaks: a German
              // sentence carrying "2023-05-10" is the machine's format leaking
              // into the copy.
              date: formatDayForLocale(checkInDate, language),
            })}
          </p>
          <label className="block text-xs text-[var(--text-primary)]">
            {t("lodging:fx.manualRateLabel", { currency, base: baseCurrency })}
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              className={inputClassName}
              value={manualFxRate}
              aria-label={t("lodging:fx.manualRateLabel", { currency, base: baseCurrency })}
              onChange={(e): void => onManualFxRateChange?.(e.target.value)}
            />
          </label>
          {manualPreview !== null && (
            <p
              data-testid="stay-editor-manual-preview"
              className="text-xs text-[var(--text-muted)]"
            >
              {manualPreview}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
