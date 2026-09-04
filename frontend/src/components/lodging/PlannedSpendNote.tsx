import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { sumByCurrency } from "../../lib/bookingCost";
import { plannedStays, type CountableStaySnapshot } from "../../lib/lodgingFormat";
import { formatCurrency } from "../../lib/units";

type PlannedStay = CountableStaySnapshot & { totalPrice: number | null; currency: string };

/**
 * A muted "planned: 149,90 €" line under a lodging's spend.
 *
 * A stay that has not happened yet is outside every total — the owner's
 * counting rule — but a booking with a price on it is not nothing, and a bare
 * "—" above a priced future stay reads as if the price had been lost
 * (forgejo#82). Renders nothing when no stay ahead carries a price.
 * Currencies are never summed together; a mixed set is written "A + B".
 */
export function PlannedSpendNote({ stays }: { stays: readonly PlannedStay[] }): JSX.Element | null {
  const { t } = useTranslation(["lodging"]);
  const totals = sumByCurrency(
    plannedStays(stays).map((s) => ({ price: s.totalPrice, currency: s.currency }))
  );
  if (totals.length === 0) return null;
  const amount = totals.map((c) => formatCurrency(c.total, c.currency)).join(" + ");
  return (
    <div className="text-[10px] text-(--text-muted)" data-testid="lodging-spend-planned">
      {t("lodging:list.spendPlanned", { amount })}
    </div>
  );
}
