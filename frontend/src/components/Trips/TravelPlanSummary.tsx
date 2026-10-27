import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravPlanVisible } from "../../hooks/useTravPlanVisible";
import { travplanApi, type PlanView } from "../../lib/api/travplan";
import { logger } from "../../lib/logger";
import { Card } from "../ui/Card";
import { StatusPill } from "../ui/Pill";

/**
 * The trip page's way into its plan. Behind the same gate as the navigation
 * entry — the beta switch, the instance switch and the account's own — since a
 * link into planning the server refuses would only bounce.
 */
export function TravelPlanSummary({ tripId }: { tripId: string }) {
  const { t } = useTranslation("travplan"),
    offered = useTravPlanVisible(),
    [plan, setPlan] = useState<PlanView | null>(null);
  useEffect(() => {
    setPlan(null);
    if (!offered) return;
    let live = true;
    travplanApi
      .get(tripId)
      .then((p) => {
        if (live) setPlan(p);
      })
      .catch((cause: unknown) => {
        // Most trips have no plan, which the server answers with an error;
        // the summary then simply is not drawn.
        logger.debug("No travel plan for trip", tripId, cause);
      });
    return () => {
      live = false;
    };
  }, [tripId, offered]);
  if (!offered || !plan) return null;
  return (
    <Card style={{ margin: "var(--ts-space-xl) 0" }}>
      <section className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
          <h2 className="t-card-title">{t("title")}</h2>
          <StatusPill status={plan.state.status === "ready" ? "flown" : "scheduled"}>
            {t(plan.state.status === "ready" ? "readyStatus" : "planningStatus")}
          </StatusPill>
        </div>
        <p className="t-body">
          {plan.state.destination} · {plan.state.startDay} – {plan.state.endDay}
        </p>
        <p className="t-caption">{t("noAutoCount")}</p>
        <Link to={"/plan/" + tripId + "/overview"} style={{ color: "var(--ts-info)" }}>
          {t("continue")}
        </Link>
      </section>
    </Card>
  );
}
