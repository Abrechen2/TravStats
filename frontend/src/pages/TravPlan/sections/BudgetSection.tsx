import { useTranslation } from "../../../hooks/useTranslation";
import { Button, Card } from "../../../components/ui";
import { PlanActions, PlanCardHead, PlanGrid, PlanGrow, PlanNotice, PlanRow } from "../planLayout";
import { PlanMetrics } from "../PlanParts";
import { formatMoney, type PlanCtx } from "../planContext";

type Entry = {
  amount: number | null;
  currency: string;
  placeholder?: boolean;
  estimate?: { amount: number; currency: string } | null;
};

/**
 * What a budget row says about its price. A placeholder counts its estimate in
 * the totals, so the row names that estimate; an unknown price says so instead
 * of printing "— EUR".
 */
function priceLine(c: Entry, t: (key: string, opts?: Record<string, unknown>) => string) {
  if (c.placeholder && c.estimate)
    return t("budgetRow.estimated", {
      amount: formatMoney(c.estimate.amount, c.estimate.currency),
    });
  if (c.amount === null) return t("budgetRow.priceOpen");
  return formatMoney(c.amount, c.currency);
}

export function BudgetSection({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { plan, state, busy, edit, mutate } = ctx;
  const entries = [
    ...state.bookings.map((b) => ({ ...b, collection: "bookings" as const })),
    ...state.costs.map((c) => ({ ...c, collection: "costs" as const })),
  ];
  return (
    <>
      <PlanMetrics budget={plan.budget} />
      <PlanNotice>
        {t("remaining")}: {formatMoney(plan.budget.remaining, state.currency)}
        {(plan.budget.unknown > 0 || plan.budget.otherCurrencies.length > 0) && (
          <p>{t("unknownCosts")}</p>
        )}
      </PlanNotice>
      <PlanGrid>
        <Card>
          <PlanCardHead
            title={t("sections.budget")}
            action={<Button onClick={() => edit("costs")}>{t("newCost")}</Button>}
          />
          {entries.map((c) => (
            <PlanRow key={c.id}>
              <PlanGrow>
                <h3 className="t-card-title">{c.title}</h3>
                <p className="t-body">
                  {priceLine(c, t)}
                  {c.paid > 0 && ` · ${t("fields.paid")}: ${formatMoney(c.paid, c.currency)}`}
                </p>
                <PlanActions>
                  <Button
                    onClick={() => edit(c.collection, c, { review: c.collection === "bookings" })}
                  >
                    {t("edit")}
                  </Button>
                  {c.amount !== null &&
                    c.paid < c.amount &&
                    (c.collection === "bookings" || c.kind === "booked") && (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          const { collection, ...value } = c;
                          void mutate({
                            type: "upsert",
                            collection,
                            value: { ...value, paid: c.amount },
                          });
                        }}
                      >
                        {t("paid")}
                      </Button>
                    )}
                  {c.collection === "costs" && (
                    <Button
                      disabled={busy}
                      onClick={() => void mutate({ type: "remove", collection: "costs", id: c.id })}
                    >
                      {t("delete")}
                    </Button>
                  )}
                </PlanActions>
              </PlanGrow>
            </PlanRow>
          ))}
        </Card>
      </PlanGrid>
    </>
  );
}
