import { afterAll, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import { CONSENT_STATUSES, SHARE_ENTITY_TYPES, SHARE_NOTICE_KINDS } from "../../../schemas/sharing";

/**
 * The sharing vocabularies live twice — as Zod unions in code and as CHECK
 * constraints in the database (spec 2026-10-16, D6). A value added on one side
 * only either cannot be written or cannot be read; this holds them together,
 * as `syncTriggers.test.ts` does for the sync feed.
 */
const CHECKS = {
  share_consents_status_check: CONSENT_STATUSES,
  share_notices_kind_check: SHARE_NOTICE_KINDS,
  share_notices_entity_type_check: SHARE_ENTITY_TYPES,
} as const;

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sharing vocabularies — code and database agree", () => {
  it.each(Object.entries(CHECKS))("%s lists exactly the code's values", async (name, values) => {
    const rows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
    expect(rows).toHaveLength(1);
    const inDb = [...rows[0].def.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(inDb).toEqual([...values].sort());
  });

  it("refuses a notice kind outside the list", async () => {
    const user = await prisma.user.create({
      data: { username: "share-test-vocab", passwordHash: "x" },
    });
    try {
      await expect(
        prisma.shareNotice.create({ data: { userId: user.id, kind: "renamed" } })
      ).rejects.toThrow(/share_notices_kind_check/);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
