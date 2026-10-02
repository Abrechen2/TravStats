import { useId } from "react";

import CurrencySelect from "../common/CurrencySelect";
import { useTranslation } from "../../hooks/useTranslation";

interface ReviewCostSectionProps {
  price: number | undefined;
  onPrice: (value: number | undefined) => void;
  currency: string;
  onCurrency: (value: string) => void;
  recentCurrencies: string[];
  taxes: number | undefined;
  onTaxes: (value: number | undefined) => void;
  fees: number | undefined;
  onFees: (value: number | undefined) => void;
  /** Taxes and fees stay behind the cost-tracking feature. */
  withTaxesAndFees: boolean;
}

/**
 * The flight review's cost block: price and currency always, matching the
 * cruise forms (#192); taxes and fees only with cost tracking on. Its own
 * module so FlightReviewModal.tsx stays under the 800-line limit once every
 * label there names its control.
 */
export default function ReviewCostSection({
  price,
  onPrice,
  currency,
  onCurrency,
  recentCurrencies,
  taxes,
  onTaxes,
  fees,
  onFees,
  withTaxesAndFees,
}: ReviewCostSectionProps): JSX.Element {
  const { t } = useTranslation(["flights", "common"]);
  const fieldId = useId();
  return (
    <div className="border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-(--text-primary) mb-3">
        {t("flights:review.costsTitle")}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor={`${fieldId}-price`}
            className="block text-sm font-medium text-(--text-primary) mb-2"
          >
            {t("common:labels.price")}
          </label>
          <input
            id={`${fieldId}-price`}
            type="number"
            step="0.01"
            value={price || ""}
            onChange={(e) => onPrice(e.target.value ? parseFloat(e.target.value) : undefined)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-(--accent)"
            placeholder={t("flights:form.placeholders.price")}
          />
        </div>

        <div>
          <label
            htmlFor={`${fieldId}-currency`}
            className="block text-sm font-medium text-(--text-primary) mb-2"
          >
            {t("flights:form.currency")}
          </label>
          <CurrencySelect
            id={`${fieldId}-currency`}
            value={currency}
            onChange={onCurrency}
            recent={recentCurrencies}
          />
        </div>

        {withTaxesAndFees && (
          <>
            <div>
              <label
                htmlFor={`${fieldId}-taxes`}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("common:labels.taxes")}
              </label>
              <input
                id={`${fieldId}-taxes`}
                type="number"
                step="0.01"
                value={taxes || ""}
                onChange={(e) => onTaxes(e.target.value ? parseFloat(e.target.value) : undefined)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-(--accent)"
                placeholder={t("flights:form.placeholders.taxes")}
              />
            </div>

            <div>
              <label
                htmlFor={`${fieldId}-fees`}
                className="block text-sm font-medium text-(--text-primary) mb-2"
              >
                {t("common:labels.fees")}
              </label>
              <input
                id={`${fieldId}-fees`}
                type="number"
                step="0.01"
                value={fees || ""}
                onChange={(e) => onFees(e.target.value ? parseFloat(e.target.value) : undefined)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-(--bg-surface) text-(--text-primary) focus:ring-2 focus:ring-(--accent)"
                placeholder={t("flights:form.placeholders.fees")}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
