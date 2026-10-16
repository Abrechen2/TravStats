import { useEffect, useState } from "react";
import { useBetaFeatures } from "./useBetaFeatures";
import { useAuthStore } from "../store/authStore";
import { travplanApi } from "../lib/api/travplan";
import { logger } from "../lib/logger";

/**
 * The instance half alone: whether the beta switch lets TravPlan be shown at
 * all. The routes and the trip page's plan summary ask this.
 */
export function useTravPlanOffered(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  return isFeatureVisible("travPlan");
}

/**
 * Whether the planning mode is offered as a destination in the navigation —
 * the one home of the rule.
 *
 * TWO conditions: the instance beta switch (`travPlan`), and the server-side
 * `travel_plan_config.enabled`, read through `/travplan/capabilities`. An
 * admin sees the entry whatever the server switch says, because `/plan/admin`
 * is the only place that switch can be turned on — hiding the way in from the
 * one person who may open it would make it unreachable.
 *
 * Chrome fails closed: while the answer is pending, or when the request
 * fails, the entry stays hidden rather than flashing into view.
 */
export function useTravPlanVisible(): boolean {
  const offered = useTravPlanOffered();
  const userId = useAuthStore((s) => s.user?.id);
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false);
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const mustAsk = offered && Boolean(userId) && !isAdmin;

  useEffect(() => {
    setServerEnabled(null);
    if (!mustAsk) return;
    let live = true;
    travplanApi
      .capabilities()
      .then((caps) => {
        if (live) setServerEnabled(caps.enabled);
      })
      .catch((cause: unknown) => {
        logger.warn("Failed to load TravPlan capabilities", cause);
        if (live) setServerEnabled(false);
      });
    return () => {
      live = false;
    };
  }, [mustAsk, userId]);

  if (!offered || !userId) return false;
  return isAdmin || serverEnabled === true;
}
