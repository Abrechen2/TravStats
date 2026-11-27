import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravPlanVisible } from "../../hooks/useTravPlanVisible";
import { travplanApi, type PlanView } from "../../lib/api/travplan";
import { logger } from "../../lib/logger";
import { apiErrorMachineCode } from "../../lib/apiError";
import Button from "../ui/Button";
import { Card } from "../ui/Card";
import { StatusPill } from "../ui/Pill";
import InlineError from "../ui/InlineError";

/**
 * The trip page's way into its plan. Behind the same gate as the navigation
 * entry — the beta switch, the instance switch and the account's own — since a
 * link into planning the server refuses would only bounce.
 *
 * `completed` is the server's own verdict on the trip (the one the trip head and the
 * packing card read). A finished trip is not asked to be planned (owner, 2026-11-22:
 * "viel zu penetrant"); a plan that already exists is still shown, read-only.
 */
export function TravelPlanSummary({
  tripId,
  completed = false,
}: {
  tripId: string;
  completed?: boolean;
}) {
  const { t } = useTranslation("travplan"),
    offered = useTravPlanVisible(),
    navigate = useNavigate(),
    [plan, setPlan] = useState<PlanView | null>(null),
    /** "none": the server says this trip has no plan. Anything else that failed is not "none". */
    [absent, setAbsent] = useState<"unknown" | "none" | "failed">("unknown"),
    [starting, setStarting] = useState(false),
    [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    setPlan(null);
    setAbsent("unknown");
    setFailure(null);
    if (!offered) return;
    let live = true;
    travplanApi
      .find(tripId)
      .then((p) => {
        if (!live) return;
        // null: the trip has no plan — the ordinary case, asked without a 404 (UAT rc.45).
        if (p) setPlan(p);
        else setAbsent("none");
      })
      .catch((cause: unknown) => {
        // Most trips have no plan: PLAN_NOT_FOUND, and that earns the "plan this trip" offer.
        // Any other answer (network, 5xx, switched off) is its own state and offers nothing.
        logger.debug("No travel plan for trip", tripId, cause);
        if (live) setAbsent(apiErrorMachineCode(cause) === "PLAN_NOT_FOUND" ? "none" : "failed");
      });
    return () => {
      live = false;
    };
  }, [tripId, offered]);
  if (offered && !plan && absent === "none" && !completed)
    return (
      <Card style={{ margin: "var(--ts-space-xl) 0" }}>
        <section className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <h2 className="t-card-title">{t("title")}</h2>
          <p className="t-body">{t("planThis.body")}</p>
          {failure && <InlineError>{failure}</InlineError>}
          <div>
            <Button
              variant="primary"
              disabled={starting}
              onClick={() => {
                setStarting(true);
                setFailure(null);
                travplanApi
                  .create(t("newTrip"), {}, tripId)
                  .then((created) => navigate("/plan/" + created.tripId + "/overview"))
                  .catch((cause: unknown) => {
                    const code = apiErrorMachineCode(cause);
                    setFailure(
                      t("errors." + (code ?? "unknown"), { defaultValue: t("errors.unknown") })
                    );
                    setStarting(false);
                  });
              }}
            >
              {t("planThis.action")}
            </Button>
          </div>
        </section>
      </Card>
    );
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
