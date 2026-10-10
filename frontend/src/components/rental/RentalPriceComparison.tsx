import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatAmount } from "../../lib/units";
import { rentalPriceComparison } from "../../lib/rental/rentalPriceComparison";
import type { RentalBooking } from "../../types/rental";
import { RentalInvoiceFeeList } from "./RentalInvoiceFeeLines";

/**
 * Gebucht · Endbetrag · Differenz in one row (forgejo#237), each naming where
 * it came from, and one line saying which amount the rental's cost counts —
 * so a reader sees at a glance that the two are compared, never added.
 */
export function RentalPriceComparison({ rental }: { rental: RentalBooking }): JSX.Element {
  const { t, i18n } = useTranslation(["rental"]);
  const c = rentalPriceComparison(rental);
  const money = (amount: number, currency: string): string =>
    formatAmount(amount, currency, { language: i18n.language });
  const signed = (amount: number, currency: string): string =>
    amount > 0 ? `+${money(amount, currency)}` : money(amount, currency);

  const cell = (
    testId: string,
    label: string,
    value: string,
    caption: string | null
  ): JSX.Element => (
    <div className="rounded-md border border-border p-3" data-testid={testId}>
      <p className="t-caption">{label}</p>
      <p className="font-mono text-base">{value}</p>
      {caption ? <p className="t-caption">{caption}</p> : null}
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {cell(
          "rental-price-booked",
          t("rental:detail.priceBooked"),
          c.booked ? money(c.booked.amount, c.booked.currency) : "–",
          c.booked
            ? t(`rental:priceSource.${c.booked.source ?? "unknown"}`)
            : t("rental:priceSource.none")
        )}
        {cell(
          "rental-price-final",
          rental.finalAmountSource === "cancellationFee"
            ? t("rental:detail.cancellationFee")
            : t("rental:detail.priceFinal"),
          c.final ? money(c.final.amount, c.final.currency) : "–",
          c.final
            ? t(`rental:finalSource.${c.final.source ?? "unknown"}`)
            : t("rental:detail.fromInvoice")
        )}
        {cell(
          "rental-price-difference",
          t("rental:detail.priceDifference"),
          c.difference ? signed(c.difference.amount, c.difference.currency) : "–",
          c.noDifference === "currency"
            ? t("rental:detail.differenceCurrencies")
            : c.noDifference === "missing"
              ? t("rental:detail.differenceMissing")
              : null
        )}
      </div>
      {/* The invoice's single lines the user took over — inside the final amount. */}
      <RentalInvoiceFeeList fees={rental.invoiceFees ?? []} />
      <p className="t-caption" data-testid="rental-price-counts">
        {c.counts ? t(`rental:detail.costCounts.${c.counts}`) : t("rental:detail.costCounts.none")}
      </p>
    </div>
  );
}
