import { useTranslation } from "../../../hooks/useTranslation";
import { Button, Card } from "../../../components/ui";
import { PlanActions, PlanCardHead, PlanGrid, PlanGrow, PlanNotice, PlanRow } from "../planLayout";
import { PlanMetrics, PlanTasks } from "../PlanParts";
import { formatMoney, type PlanCtx } from "../planContext";

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
                  {c.amount ?? "—"} {c.currency} · {t("fields.paid")}: {c.paid}
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
        <PlanTasks state={state} busy={busy} edit={(task) => edit("tasks", task)} mutate={mutate} />
      </PlanGrid>
    </>
  );
}
