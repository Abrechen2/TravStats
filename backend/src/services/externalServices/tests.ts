/**
 * Persisted connection-test results (forgejo#392): the last test of a service
 * is kept so the page can say "geprüft vor 2 Tagen, fehlgeschlagen: …" without
 * calling out again. One row per (account | instance, service), enforced by
 * unique indexes and replaced on every test.
 */
import { randomUUID } from "crypto";
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
  // One atomic upsert per scope. The unique indexes (migration
  // `external_service_tests_unique`) make a concurrent first test collide into
  // an update instead of leaving two rows. Prisma cannot name a partial unique
  // (the instance scope, NULL user_id), so both go through ON CONFLICT.
  const id = randomUUID();
  if (userId === null) {
    await prisma.$executeRaw`
      INSERT INTO external_service_tests (id, user_id, service_id, at, ok, reason)
      VALUES (${id}, NULL, ${serviceId}, ${at}, ${ok}, ${reason})
      ON CONFLICT (service_id) WHERE user_id IS NULL
      DO UPDATE SET at = EXCLUDED.at, ok = EXCLUDED.ok, reason = EXCLUDED.reason`;
  } else {
    await prisma.externalServiceTest.upsert({
      where: { userId_serviceId: { userId, serviceId } },
      create: { userId, serviceId, ok, reason, at },
      update: { ok, reason, at },
    });
  }
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
