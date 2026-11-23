import { prisma } from "../db";
import { ensureAdminSettingsRow } from "./adminSettingsRow";

/**
 * "The demo account was removed by an administrator" is state, not an absence
 * (forgejo: demo respawn). Deleting the account used to leave nothing behind, so
 * the next boot with `CREATE_DEMO_USER=true` (or a first install) seeded it
 * again and the admin's deletion silently undid itself.
 */

/** The operator's explicit override: the seeder runs on every boot. */
export function demoForcedByEnv(): boolean {
  return process.env.CREATE_DEMO_USER === "true";
}

export async function getDemoRemovedAt(): Promise<Date | null> {
  const row = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { demoRemovedAt: true },
  });
  return row?.demoRemovedAt ?? null;
}

export async function markDemoRemoved(at: Date = new Date()): Promise<void> {
  const id = await ensureAdminSettingsRow();
  await prisma.adminSettings.update({ where: { id }, data: { demoRemovedAt: at } });
}

export async function clearDemoRemoved(): Promise<void> {
  const id = await ensureAdminSettingsRow();
  await prisma.adminSettings.update({ where: { id }, data: { demoRemovedAt: null } });
}

/**
 * Whether a boot-time seed may create the demo account. An admin's removal is
 * final unless the operator forces the seed with the env var.
 */
export async function demoSeedAllowed(): Promise<boolean> {
  if (demoForcedByEnv()) return true;
  return (await getDemoRemovedAt()) === null;
}
