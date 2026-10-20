/**
 * Test helper: set the instance switches trip sharing across servers reads, and put them back.
 * Not a suite (no `.test.ts` suffix).
 */
import type { PrismaClient } from "../../../../prisma";
import { ensureAdminSettingsRow } from "../../../adminSettingsRow";

type Flags = { betaFeaturesEnabled: boolean; tripFederationEnabled: boolean };
type Client = Pick<PrismaClient, "adminSettings">;

export async function setTripFlags(flags: Partial<Flags>, client?: Client): Promise<Flags> {
  const db = client ?? (await import("../../../../db")).prisma;
  const id = client
    ? ((await db.adminSettings.findFirst({ orderBy: { id: "asc" } }))?.id ??
      (await db.adminSettings.create({ data: {} })).id)
    : await ensureAdminSettingsRow();
  const before = await db.adminSettings.findUniqueOrThrow({
    where: { id },
    select: { betaFeaturesEnabled: true, tripFederationEnabled: true },
  });
  await db.adminSettings.update({ where: { id }, data: flags });
  return before;
}
