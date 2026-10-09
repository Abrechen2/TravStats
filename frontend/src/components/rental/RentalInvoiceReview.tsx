import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { rentalApi } from "../../lib/api/rental";
import { logger } from "../../lib/logger";
import { formatAmount } from "../../lib/units";
import {
  invoiceDifference,
  rentalInvoiceDiff,
  type RentalInvoicePart,
} from "../../lib/rental/rentalInvoiceDiff";
import type { RentalBooking, RentalInvoiceReading } from "../../types/rental";
import { CHECK_ROW } from "./rentalFormFields";

export type InvoiceAdoption = Record<RentalInvoicePart, boolean>;

export const ADOPT_ALL: InvoiceAdoption = {
  finalAmount: true,
  vehicleDriven: true,
  odometer: true,
  distance: true,
  actualTimes: true,
};

interface Props {
  invoice: RentalInvoiceReading;
  /** The rental the invoice belongs to (the parse found it by its numbers). */
  rentalId: string;
  adopt: InvoiceAdoption;
  onAdoptChange: (next: InvoiceAdoption) => void;
}

/**
 * The invoice beside the booking it belongs to (forgejo#237): booked price,
 * invoiced amount and their difference first, then each reading of the
 * invoice against what the rental holds, every changed one taken over on its
 * own. The booked price is never replaced — it stays to compare against.
 *
 * Fee lines are NOT read out of any invoice yet, and the review says so: the
 * difference is their sum. A rental that cannot be loaded is said, with a
 * retry, and the readings are still listed — never a comparison against
 * nothing dressed up as "unchanged".
 */
export function RentalInvoiceReview({
  invoice,
  rentalId,
  adopt,
  onAdoptChange,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation(["rental", "common"]);
  const locale = i18n.language.startsWith("en") ? "en-GB" : "de-DE";
  const [rental, setRental] = useState<RentalBooking | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    rentalApi
      .get(rentalId)
      .then((loaded) => {
        if (!cancelled) setRental(loaded);
      })
      .catch((err: unknown) => {
        logger.warn("RentalInvoiceReview: the booking could not be loaded", err);
        if (!cancelled) setFailed(true);
      });
    return (): void => {
      cancelled = true;
    };
  }, [rentalId, attempt]);

  const money = (m: { amount: number; currency: string }): string =>
    formatAmount(m.amount, m.currency, { language: i18n.language });
  const rows = rentalInvoiceDiff(rental, invoice, {
    money,
    km: (km) => `${km.toLocaleString(locale)} km`,
    time: (local) => local.replace("T", " "),
  });
  const difference = invoiceDifference(rental, invoice);

  return (
    <div className="space-y-3" data-testid="rental-invoice-review">
      {failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-(--danger)">
          <span>{t("rental:invoiceReview.loadFailed")}</span>
          <button
            type="button"
            onClick={(): void => setAttempt((n) => n + 1)}
            className="rounded-md border border-(--danger)/50 px-3 py-1 pointer-coarse:min-h-(--ts-size-touch-min)"
          >
            {t("common:buttons.retry")}
          </button>
        </div>
      ) : null}
      {rental ? (
        <dl className="grid grid-cols-3 gap-2" data-testid="rental-invoice-amounts">
          <div>
            <dt className="t-caption">{t("rental:detail.priceBooked")}</dt>
            <dd className="font-mono">
              {rental.price !== null && rental.currency
                ? money({ amount: rental.price, currency: rental.currency })
                : "–"}
            </dd>
          </div>
          <div>
            <dt className="t-caption">{t("rental:detail.priceFinal")}</dt>
            <dd className="font-mono">
              {invoice.finalAmount !== null && invoice.finalCurrency
                ? money({ amount: invoice.finalAmount, currency: invoice.finalCurrency })
                : "–"}
            </dd>
          </div>
          <div>
            <dt className="t-caption">{t("rental:detail.priceDifference")}</dt>
            <dd className="font-mono" data-testid="rental-invoice-difference">
              {difference
                ? `${difference.amount > 0 ? "+" : ""}${money(difference)}`
                : t("rental:invoiceReview.noDifference")}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="t-caption">{t("rental:invoiceReview.feesNote")}</p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.part} data-testid={`rental-invoice-row-${row.part}`}>
            <p className="font-medium">{t(`rental:invoiceReview.part.${row.part}`)}</p>
            <p className="t-caption">
              {t("rental:invoiceReview.now", {
                value: row.current ?? t("rental:invoiceReview.nothingYet"),
              })}{" "}
              · {t("rental:invoiceReview.invoice", { value: row.incoming })}
            </p>
            {row.same ? (
              <p className="t-caption">{t("rental:invoiceReview.same")}</p>
            ) : (
              <label className={CHECK_ROW}>
                <input
                  type="checkbox"
                  checked={adopt[row.part]}
                  onChange={(e): void => onAdoptChange({ ...adopt, [row.part]: e.target.checked })}
                />
                {t("rental:invoiceReview.adopt")}
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
