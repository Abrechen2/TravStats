import { useTranslation } from "../../../hooks/useTranslation";
import { Button, Card } from "../../../components/ui";
import { PlanActions, PlanCardHead, PlanStack } from "../planLayout";
import { newEntry } from "../editorModel";
import { entryRecord, type PlanCtx } from "../planContext";
import { FindingCards } from "./FindingCards";

export function TransferSection({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { plan, state, busy, day, days, edit, mutate } = ctx;
  return (
    <>
      <p className="t-body">{t("transferIntro")}</p>
      <PlanStack>
        {plan.findings
          .filter((f) => f.code === "transferOpen" || f.code === "transferReview")
          .map((f) => {
            const transfer = state.transfers.find(
              (x) => x.fromId === f.params.fromId && x.toId === f.params.toId
            );
            return (
              <Card key={f.id}>
                <PlanCardHead title={t("findings." + f.code, f.params)} />
                <p className="t-body">{transfer?.note}</p>
                <PlanActions>
                  <Button
                    onClick={() =>
                      edit(
                        "transfers",
                        transfer || {
                          ...newEntry("transfers", null, state.currency, day),
                          fromId: f.params.fromId,
                          toId: f.params.toId,
                        }
                      )
                    }
                  >
                    {t("organized")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void mutate({
                        type: "upsert",
                        collection: "transfers",
                        value: entryRecord({
                          ...newEntry("transfers", null, state.currency, day),
                          ...transfer,
                          fromId: f.params.fromId,
                          toId: f.params.toId,
                          status: "conscious",
                        }),
                      })
                    }
                  >
                    {t("conscious")}
                  </Button>
                </PlanActions>
              </Card>
            );
          })}
        {state.transfers.map((x) => (
          <Card key={x.id}>
            <h3 className="t-card-title">
              {x.mode || t("transferPlan")} · {t("options." + x.status)}
            </h3>
            <p className="t-body">
              {x.note} · {x.duration ?? "—"} + {x.buffer} min
            </p>
            <PlanActions>
              <Button onClick={() => edit("transfers", x)}>{t("edit")}</Button>
            </PlanActions>
          </Card>
        ))}
        <p className="t-caption">{t("transferAssumption")}</p>
        <FindingCards ctx={ctx} all />
        {plan.findings.some((f) => f.code === "nightGap") && (
          <div>
            <Button
              disabled={busy}
              onClick={() =>
                void mutate({ type: "settings", values: { openNights: days.slice(0, -1) } })
              }
            >
              {t("nightOpen")}
            </Button>
          </div>
        )}
      </PlanStack>
    </>
  );
}
