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
 * `travel_plan_config.enabled`, read through `/travplan/capabilities` — for
 * admins too. Until 2026-10-26 an admin saw the entry whatever the server
 * switch said, because `/plan/admin` was the only place to turn it on; the
 * switch now lives in Admin → Instanz → TravPlan as well, and `/plan/admin`
 * stays reachable by URL and from that section's link.
 *
 * Chrome fails closed: while the answer is pending, or when the request
 * fails, the entry stays hidden rather than flashing into view.
 */
export function useTravPlanVisible(): boolean {
  const offered = useTravPlanOffered();
  const userId = useAuthStore((s) => s.user?.id);
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const mustAsk = offered && Boolean(userId);

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
  return serverEnabled === true;
}
