import { AppError } from "../../middleware/errorHandler";
import { getInstanceSettings } from "../instanceSettingsService";

/**
 * Whether the instance's beta switch lets TravPlan exist at all (`travPlan` in the frontend's
 * beta registry). The web hides the planning mode behind it, but until 2026-10-22 the server
 * did not ask: every plan endpoint — and the half-built v2 route-plan endpoints merged without
 * a screen — answered any signed-in client on an instance whose switch was off. A phone keeps
 * calling long after anybody looks at the page that hid it, so the server asks too, as it does
 * for the calendar feed and trip sharing across servers.
 */
export async function travPlanOffered(): Promise<boolean> {
  return (await getInstanceSettings()).betaFeaturesEnabled;
}

/**
 * Refuses with the code a client already reads for "planning is off on this server"
 * (`PLAN_DISABLED`, as `assertEnabled` throws for `travel_plan_config.enabled`), so the
 * Companion and the web need no second refusal to understand.
 */
export async function assertTravPlanOffered(): Promise<void> {
  if (!(await travPlanOffered()))
    throw new AppError(
      "Travel planning is a beta feature that is switched off on this server",
      403,
      "PLAN_DISABLED"
    );
}
