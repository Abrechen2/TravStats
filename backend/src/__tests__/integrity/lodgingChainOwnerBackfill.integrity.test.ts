import fs from "fs";
import path from "path";
import { prisma } from "../../db";

/**
 * The per-user chains migration (2026-09-25) hands existing user-added chains
 * to the account that created them. There is no creator column, so it derives
 * one from who USES the chain: exactly one account → that account's; several
 * or none → stays in the catalogue, where everyone saw it before.
 *
 * The statement is read out of the migration file itself and run against
 * fixtures in the pre-migration shape (user_id NULL), so this measures
 * the SQL that ships, not a copy of it.
 */
const MIGRATION = path.resolve(
  __dirname,
  "../../../prisma/migrations/20260925220000_per_user_lodging_chains/migration.sql"
);

function backfillStatement(): string {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const match = sql.match(/WITH users_per_chain[\s\S]*?is_user_added = true;/);
  if (!match) throw new Error("backfill statement not found in the migration");
  // The loyalty migration that sorts after this one (20260925230000) renames
  // the table the statement joins; the statement ran against the old name in
  // the migration chain, and runs against today's name here.
  if (!match[0].includes('"lodging_memberships"')) {
    throw new Error("backfill statement no longer joins lodging_memberships — revisit this test");
  }
  return match[0].replace(/"lodging_memberships"/g, '"loyalty_memberships"');
}

describe("per-user chains migration — who a user-added chain is given to", () => {
  const stamp = Date.now();
  const names = {
    onlyA: `Mig OnlyA ${stamp}`,
    shared: `Mig Shared ${stamp}`,
    unused: `Mig Unused ${stamp}`,
    seeded: `Mig Seeded ${stamp}`,
    memberB: `Mig MemberB ${stamp}`,
    lodgeAMemberB: `Mig LodgeA MemberB ${stamp}`,
  };
  let aId: string;
  let bId: string;
  const ids: Record<keyof typeof names, number> = {} as never;
  const owners = new Map<number, string | null>();

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["mig_a", "mig_b"] } } });
    aId = (await prisma.user.create({ data: { username: "mig_a", passwordHash: "x" } })).id;
    bId = (await prisma.user.create({ data: { username: "mig_b", passwordHash: "x" } })).id;
    for (const [key, name] of Object.entries(names) as [keyof typeof names, string][]) {
      const chain = await prisma.lodgingChain.create({
        data: { name, isUserAdded: key !== "seeded" },
      });
      ids[key] = chain.id;
    }
    const lodge = (userId: string, chainId: number) =>
      prisma.lodging.create({ data: { userId, name: `H ${chainId}`, chainId } });
    await lodge(aId, ids.onlyA);
    await lodge(aId, ids.shared);
    await lodge(bId, ids.shared);
    await lodge(aId, ids.seeded);
    await lodge(aId, ids.lodgeAMemberB);
    await prisma.loyaltyMembership.create({
      data: {
        userId: bId,
        programName: `P ${stamp}`,
        chains: { create: [{ chainId: ids.memberB }, { chainId: ids.lodgeAMemberB }] },
      },
    });
    // Run inside a transaction that is rolled back: the statement sweeps the
    // whole table, and other suites' rows in this shared database are not
    // this test's to reassign.
    const ROLLBACK = new Error("rollback");
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(backfillStatement());
        const rows = await tx.lodgingChain.findMany({
          where: { id: { in: Object.values(ids) } },
          select: { id: true, userId: true },
        });
        for (const row of rows) owners.set(row.id, row.userId);
        throw ROLLBACK;
      })
      .catch((error: unknown) => {
        if (error !== ROLLBACK) throw error;
      });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [aId, bId] } } });
    await prisma.lodgingChain.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  const ownerOf = async (key: keyof typeof names): Promise<string | null | undefined> =>
    owners.get(ids[key]);

  it("gives a chain used by one account to that account — by hotel or by membership", async () => {
    expect(await ownerOf("onlyA")).toBe(aId);
    expect(await ownerOf("memberB")).toBe(bId);
  });

  it("leaves a chain several accounts use in the catalogue", async () => {
    expect(await ownerOf("shared")).toBeNull();
    expect(await ownerOf("lodgeAMemberB")).toBeNull();
  });

  it("leaves an unused chain and a seeded one in the catalogue", async () => {
    expect(await ownerOf("unused")).toBeNull();
    expect(await ownerOf("seeded")).toBeNull();
  });
});
