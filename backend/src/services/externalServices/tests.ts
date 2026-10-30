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
  const existing = await prisma.externalServiceTest.findFirst({ where: { userId, serviceId } });
  const at = new Date();
  const data = { ok, reason, at };
  if (existing) {
    await prisma.externalServiceTest.update({ where: { id: existing.id }, data });
  } else {
    await prisma.externalServiceTest.create({ data: { userId, serviceId, ...data } });
  }
  return { at: at.toISOString(), ok, reason };
}

/** Every stored result of one scope, keyed by service id. */
export async function loadAllTests(userId: string | null): Promise<Map<string, LastTest>> {
  const rows = await prisma.externalServiceTest.findMany({ where: { userId } });
  return new Map(
    rows.map((r) => [r.serviceId, { at: r.at.toISOString(), ok: r.ok, reason: r.reason }])
  );
}
