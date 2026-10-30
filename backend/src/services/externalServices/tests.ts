/**
 * Persisted connection-test results (forgejo#392): the last test of a service
 * is kept so the page can say "geprüft vor 2 Tagen, fehlgeschlagen: …" without
 * calling out again. One row per (account | instance, service), replaced on
 * every test.
 */
import { prisma } from "../../db";
import type { LastTest } from "./types";

export type { LastTest };

export async function recordTest(
  userId: string | null,
  serviceId: string,
  ok: boolean,
  reason: string | null
): Promise<LastTest> {
  const at = new Date();
  // Replace in one transaction: a concurrent first test cannot leave two rows
  // (readers also take the newest, see `loadAllTests`).
  await prisma.$transaction([
    prisma.externalServiceTest.deleteMany({ where: { userId, serviceId } }),
    prisma.externalServiceTest.create({ data: { userId, serviceId, ok, reason, at } }),
  ]);
  return { at: at.toISOString(), ok, reason };
}

/** Every stored result of one scope, keyed by service id. */
export async function loadAllTests(userId: string | null): Promise<Map<string, LastTest>> {
  const rows = await prisma.externalServiceTest.findMany({
    where: { userId },
    orderBy: { at: "asc" },
  });
  return new Map(
    rows.map((r) => [r.serviceId, { at: r.at.toISOString(), ok: r.ok, reason: r.reason }])
  );
}
