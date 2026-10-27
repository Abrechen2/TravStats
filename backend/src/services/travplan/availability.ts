import { prisma } from "../../db";
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

/**
 * The account's own switch (owner, 2026-10-27: "nichts davon muss genutzt werden, alles
 * einzeln aktivierbar so wie die Domains"). `user_settings.trav_plan_enabled`, off by default
 * like every domain but flights; an account without a settings row has it off. The migration
 * switched it on for every account that already held a plan.
 */
export async function travPlanUserEnabled(userId: string): Promise<boolean> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { travPlanEnabled: true },
  });
  return row?.travPlanEnabled ?? false;
}

/**
 * Refuses with `PLAN_USER_DISABLED`: the instance offers planning, this account switched it
 * off. A code of its own so a client can say "switch it on in your settings" instead of
 * "your server has no planning". Nothing is deleted — the plans come back when switched on,
 * and the account export carries them meanwhile (`services/export/allDataExport.ts`), as
 * TravTrack's `held` tier keeps export and delete while TravTrack is off.
 */
export async function assertTravPlanForUser(userId: string): Promise<void> {
  if (!(await travPlanUserEnabled(userId)))
    throw new AppError(
      "Travel planning is switched off for this account",
      403,
      "PLAN_USER_DISABLED"
    );
}
