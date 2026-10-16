import { useTranslation } from "../../../hooks/useTranslation";
import { Button, Card } from "../../../components/ui";
import { PlanActions, PlanLink } from "../planLayout";
import type { PlanCtx } from "../planContext";

const OVERVIEW_FINDINGS = 3;
const ALL_FINDINGS = 500;

export function FindingCards({ ctx, all = false }: { ctx: PlanCtx; all?: boolean }) {
  const { t } = useTranslation("travplan"),
    { plan, busy, mutate, prefix } = ctx;
  const decide = (f: (typeof plan.findings)[number], choice: "conscious" | "dismissed") =>
    void mutate({
      type: "decision",
      value: {
        id: f.id,
        fingerprint: f.fingerprint,
        choice,
        decidedAt: new Date().toISOString(),
      },
    });
  return (
    <>
      {plan.findings.slice(0, all ? ALL_FINDINGS : OVERVIEW_FINDINGS).map((f) => (
        <Card key={f.id}>
          <h3 className="t-card-title">{t("findings." + f.code, f.params)}</h3>
          <PlanActions>
            <PlanLink to={prefix + "/" + f.section}>{t("edit")}</PlanLink>
            <Button disabled={busy} onClick={() => decide(f, "conscious")}>
              {t("conscious")}
            </Button>
            <Button disabled={busy} onClick={() => decide(f, "dismissed")}>
              {t("dismiss")}
            </Button>
          </PlanActions>
        </Card>
      ))}
    </>
  );
}
