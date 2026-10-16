import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import type { Prisma } from "../../../prisma";
import { leaderboardScopeSchema } from "../../../schemas/comparison";

const MIGRATIONS = path.join(__dirname, "..", "..", "..", "..", "prisma", "migrations");
const dir = fs.readdirSync(MIGRATIONS).find((d) => d.endsWith("_leaderboard_tables"));
const sql = dir ? fs.readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8") : "";
const copy = sql.slice(
  sql.indexOf("-- BEGIN LEADERBOARD DATA COPY"),
  sql.indexOf("-- END LEADERBOARD DATA COPY")
);
const users: string[] = [];

type OldScope = { statistics: boolean; domains?: string[] };

const oldScope = ({ statistics, domains }: OldScope) =>
  ({
    statistics,
    details: false,
    costs: true,
    personal: false,
    photos: false,
    documents: false,
    ...(domains ? { domains } : {}),
    tripIds: [],
    futureTrips: true,
    year: null,
    precision: "exact",
    expiresAt: null,
    acceptedAt: new Date().toISOString(),
    allExisting: false,
  }) as unknown as Prisma.InputJsonValue;

async function user(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `lb-mig-${randomUUID()}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
}
async function friends(a: string, b: string, scope: OldScope, revoked = false) {
  const channel = randomUUID();
  const common = { channel, origin: "local", confirmed: true, remoteConfirmed: true, revoked };
  const fromA = await prisma.comparisonLink.create({ data: { ...common, userId: a, label: "b" } });
  await prisma.comparisonLink.create({ data: { ...common, userId: b, label: "a" } });
  await prisma.comparisonGrant.create({
    data: { linkId: fromA.id, audience: "", scope: oldScope(scope) },
  });
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("ships the data copy between its markers", () => {
  expect(dir).toBeDefined();
  expect(copy).toContain('INSERT INTO "leaderboard_consents"');
});

it("carries an active statistics grant over as an accepted consent, exactly once", async () => {
  const [a, b, c, d] = [await user(), await user(), await user(), await user()];
  await friends(a, b, { statistics: true, domains: ["flight", "rail"] });
  await friends(a, c, { statistics: false, domains: ["flight", "rail"] });
  await friends(a, d, { statistics: true, domains: ["flight", "rail"] }, true);
  await prisma.$executeRawUnsafe(copy);
  await prisma.$executeRawUnsafe(copy);
  const rows = await prisma.leaderboardConsent.findMany({ where: { ownerId: a } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ viewerId: b, remoteId: null, status: "accepted" });
  expect(rows[0].scope).toEqual({
    groups: ["distance", "trips", "time", "places"],
    domains: ["flight", "rail"],
    year: null,
  });
});

it("de-duplicates domains and always produces a scope the schema accepts", async () => {
  const [a, b, c] = [await user(), await user(), await user()];
  await friends(a, b, { statistics: true, domains: ["flight", "flight", "rail"] });
  await friends(a, c, { statistics: true });
  await prisma.$executeRawUnsafe(copy);
  const rows = await prisma.leaderboardConsent.findMany({ where: { ownerId: a } });
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(leaderboardScopeSchema.safeParse(row.scope).success).toBe(true);
  const dup = rows.find((r) => r.viewerId === b);
  expect((dup?.scope as { domains: string[] }).domains.slice().sort()).toEqual(["flight", "rail"]);
});

it("holds exactly one viewer kind and a known status per consent", async () => {
  const a = await user();
  await expect(
    prisma.$executeRawUnsafe(
      `INSERT INTO "leaderboard_consents" ("id","owner_id","status") VALUES ('${randomUUID()}','${a}','pending')`
    )
  ).rejects.toThrow();
  await expect(
    prisma.$executeRawUnsafe(
      `INSERT INTO "leaderboard_consents" ("id","owner_id","viewer_id","status") VALUES ('${randomUUID()}','${a}','${a}','maybe')`
    )
  ).rejects.toThrow();
});
