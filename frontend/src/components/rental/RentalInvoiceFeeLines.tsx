import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { formatAmount } from "../../lib/units";
import { feesTotal, type InvoiceFeeRow } from "../../lib/rental/rentalInvoiceFees";
import type { RentalInvoiceFee } from "../../types/rental";
import { CHECK_ROW } from "./rentalFormFields";

interface ReviewProps {
  rows: InvoiceFeeRow[];
  picks: boolean[];
  onPicksChange: (next: boolean[]) => void;
  /** Booked → invoiced, when it can be computed. */
  difference: { amount: number; currency: string } | null;
}

/**
 * The invoice's single fee lines in the import review (forgejo#237): each
 * one with its amount, taken over on its own. The caption says what they add
 * up to beside the difference to the booking, and that they are inside the
 * final amount — so a reader never takes them for a cost on top. Without a
 * line read, it says that the difference is all there is.
 */
export function RentalInvoiceFeeReview({
  rows,
  picks,
  onPicksChange,
  difference,
}: ReviewProps): JSX.Element {
  const { t, i18n } = useTranslation(["rental"]);
  const money = (m: { amount: number; currency: string }): string =>
    formatAmount(m.amount, m.currency, { language: i18n.language });

  if (rows.length === 0) {
    return (
      <p className="t-caption" data-testid="rental-invoice-no-fees">
        {t("rental:invoiceReview.fees.none")}
      </p>
    );
  }
  const total = feesTotal(rows);
  return (
    <section className="space-y-2" data-testid="rental-invoice-fees">
      <p className="font-medium">{t("rental:invoiceReview.fees.title")}</p>
      <p className="t-caption" data-testid="rental-invoice-fees-total">
        {total
          ? t(
              difference && difference.currency === total.currency
                ? "rental:invoiceReview.fees.totalBesideDifference"
                : "rental:invoiceReview.fees.total",
              {
                total: money(total),
                difference: difference ? money(difference) : "",
              }
            )
          : t("rental:invoiceReview.fees.mixedCurrencies")}
      </p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li
            key={row.index}
            className="flex flex-wrap items-center justify-between gap-2"
            data-testid={`rental-invoice-fee-${row.index}`}
          >
            <span>
              {row.label} <span className="font-mono">{money(row)}</span>
            </span>
            {row.recorded ? (
              <span className="t-caption">{t("rental:invoiceReview.fees.recorded")}</span>
            ) : (
              <label className={CHECK_ROW}>
                <input
                  type="checkbox"
                  checked={picks[row.index] ?? false}
                  onChange={(e): void =>
                    onPicksChange(picks.map((p, i) => (i === row.index ? e.target.checked : p)))
                  }
                  aria-label={t("rental:invoiceReview.fees.adoptLine", { label: row.label })}
                />
                {t("rental:invoiceReview.adopt")}
              </label>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The fee lines a rental holds, on its page — explained as part of the final amount. */
export function RentalInvoiceFeeList({ fees }: { fees: RentalInvoiceFee[] }): JSX.Element | null {
  const { t, i18n } = useTranslation(["rental"]);
  if (fees.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="rental-invoice-fee-list">
      <p className="t-caption">{t("rental:detail.feesFromInvoice")}</p>
      <ul className="space-y-0.5 text-sm">
        {fees.map((fee, i) => (
          <li key={`${fee.label}-${i}`} className="flex justify-between gap-2">
            <span>{fee.label}</span>
            <span className="font-mono">
              {formatAmount(fee.amount, fee.currency, { language: i18n.language })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
