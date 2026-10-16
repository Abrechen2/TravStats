import { useTranslation } from "../../../hooks/useTranslation";
import { HeroCard, StatusPill } from "../../../components/ui";
import { PlanGrid, PlanLink, PlanStack } from "../planLayout";
import { PlanMetrics, PlanTasks } from "../PlanParts";
import { FindingCards } from "./FindingCards";
import type { PlanCtx } from "../planContext";

export function OverviewSection({ ctx }: { ctx: PlanCtx }) {
  const { t } = useTranslation("travplan"),
    { plan, state, busy, prefix, edit, mutate } = ctx;
  return (
    <>
      <HeroCard>
        <PlanStack>
          <div>
            <StatusPill status={state.status === "ready" ? "flown" : "scheduled"}>
              {t(state.status === "ready" ? "readyStatus" : "planningStatus")}
            </StatusPill>
          </div>
          <h2 className="t-card-title">{state.destination || plan.name}</h2>
          <p className="t-body">{t("intro")}</p>
          <div>
            <PlanLink variant="primary" to={prefix + "/workspace"}>
              {t("continue")}
            </PlanLink>
          </div>
        </PlanStack>
      </HeroCard>
      <PlanMetrics budget={plan.budget} />
      <PlanGrid>
        <PlanStack>
          <FindingCards ctx={ctx} />
          <p className="t-caption">{t("noPush")}</p>
        </PlanStack>
        <PlanTasks state={state} busy={busy} edit={(task) => edit("tasks", task)} mutate={mutate} />
      </PlanGrid>
    </>
  );
}
