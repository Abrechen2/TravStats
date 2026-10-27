import { useEffect, useState } from "react";
import { useBetaFeatures } from "./useBetaFeatures";
import { useAuthStore } from "../store/authStore";
import { travplanApi, type PlanCapabilities } from "../lib/api/travplan";
import { logger } from "../lib/logger";
import { useCapabilitiesEpochStore } from "../store/capabilitiesEpochStore";

/**
 * The instance half alone: whether the beta switch lets TravPlan be shown at
 * all. The routes and the trip page's plan summary ask this.
 */
export function useTravPlanOffered(): boolean {
  const { isFeatureVisible } = useBetaFeatures();
  return isFeatureVisible("travPlan");
}

/**
 * What `/travplan/capabilities` answered for this session: `undefined` while
 * the answer is pending, `null` when it failed or was not asked because the
 * instance does not offer TravPlan. Re-asked whenever a switch it depends on
 * is saved (the capabilities epoch).
 */
export function useTravPlanCapabilities(): PlanCapabilities | null | undefined {
  const offered = useTravPlanOffered();
  const userId = useAuthStore((s) => s.user?.id);
  // Bumped when Admin → Instanz → TravPlan or the account's own switch saves,
  // so the entry follows at once.
  const epoch = useCapabilitiesEpochStore((s) => s.epoch.travPlan);
  const [caps, setCaps] = useState<PlanCapabilities | null | undefined>(undefined);
  const mustAsk = offered && Boolean(userId);

  useEffect(() => {
    setCaps(undefined);
    if (!mustAsk) return;
    let live = true;
    travplanApi
      .capabilities()
      .then((answer) => {
        if (live) setCaps(answer);
      })
      .catch((cause: unknown) => {
        logger.warn("Failed to load TravPlan capabilities", cause);
        if (live) setCaps(null);
      });
    return () => {
      live = false;
    };
  }, [mustAsk, userId, epoch]);

  return mustAsk ? caps : null;
}

/**
 * Whether the planning mode is offered as a destination in the navigation —
 * the one home of the rule.
 *
 * THREE conditions: the instance beta switch (`travPlan`), the server-side
 * `travel_plan_config.enabled`, and since 2026-10-27 the account's own switch
 * (Einstellungen → Bereiche, owner: "alles einzeln aktivierbar so wie die
 * Domains"). The server folds the last two into `/travplan/capabilities`'
 * `enabled`, for admins too — the instance switch lives in Admin → Instanz →
 * TravPlan, and `/plan/admin` stays reachable by URL and from that section.
 *
 * Chrome fails closed: while the answer is pending, or when the request
 * fails, the entry stays hidden rather than flashing into view.
 */
export function useTravPlanVisible(): boolean {
  return useTravPlanCapabilities()?.enabled === true;
}

/**
 * Whether the instance offers TravPlan, whatever this account chose — the
 * condition for showing the account's switch at all. A server from before
 * 2026-10-27 has no `instanceEnabled`; its `enabled` is the instance half.
 */
export function useTravPlanInstanceOn(): boolean {
  const caps = useTravPlanCapabilities();
  return caps ? (caps.instanceEnabled ?? caps.enabled) : false;
}
