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

  it("holds each side of a consent to exactly one party, and one side local (F3)", async () => {
    const rows = await prisma.$queryRaw<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'share_consents_party_check'`;
    expect(rows).toHaveLength(1);
    const a = await prisma.user.create({
      data: { username: "share-test-party-a", passwordHash: "x" },
    });
    const b = await prisma.user.create({
      data: { username: "share-test-party-b", passwordHash: "x" },
    });
    const far = (channel: string) =>
      prisma.remoteShareAccount.create({
        data: {
          userId: a.id,
          origin: "https://party.vocab.test",
          channel,
          localChannel: channel,
          username: "far",
          displayName: "Far",
        },
      });
    try {
      const [r1, r2] = [await far("c1"), await far("c2")];
      for (const data of [
        { requesterId: a.id, remoteRequesterId: r1.id, targetId: b.id },
        { requesterId: a.id, targetId: b.id, remoteTargetId: r1.id },
        { requesterId: a.id },
        { targetId: b.id },
        { remoteRequesterId: r1.id, remoteTargetId: r2.id },
      ])
        await expect(prisma.shareConsent.create({ data })).rejects.toThrow(
          /share_consents_party_check/
        );
      await expect(
        prisma.shareConsent.create({ data: { requesterId: a.id, remoteTargetId: r1.id } })
      ).resolves.toBeTruthy();
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    }
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
