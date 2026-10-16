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

type OldScope = { statistics: boolean; domains?: string[]; year?: number | string | null };

const oldScope = ({ statistics, domains, year = null }: OldScope) =>
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
    year,
    precision: "exact",
    expiresAt: null,
    acceptedAt: new Date().toISOString(),
    allExisting: false,
  }) as unknown as Prisma.InputJsonValue;

const quietly = async (run: () => Promise<unknown>) => {
  const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
};

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
  await friends(a, c, { statistics: true, domains: ["flight", "teleport"], year: 2200 });
  await prisma.$executeRawUnsafe(copy);
  const rows = await prisma.leaderboardConsent.findMany({ where: { ownerId: a } });
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(leaderboardScopeSchema.safeParse(row.scope).success).toBe(true);
  const dup = rows.find((r) => r.viewerId === b);
  expect((dup?.scope as { domains: string[] }).domains.slice().sort()).toEqual(["flight", "rail"]);
  const known = rows.find((r) => r.viewerId === c);
  expect(known?.scope).toMatchObject({ domains: ["flight"], year: 2200 });
});

it("never widens a grant: no domains, an empty list, only unknown domains or a bad year copy nothing", async () => {
  const a = await user();
  await friends(a, await user(), { statistics: true });
  await friends(a, await user(), { statistics: true, domains: [] });
  await friends(a, await user(), { statistics: true, domains: ["teleport"] });
  await friends(a, await user(), { statistics: true, domains: ["flight"], year: 1899 });
  await friends(a, await user(), { statistics: true, domains: ["flight"], year: "2024" });
  await friends(a, await user(), { statistics: true, domains: ["flight"], year: 2201 });
  await prisma.$executeRawUnsafe(copy);
  expect(await prisma.leaderboardConsent.count({ where: { ownerId: a } })).toBe(0);
});

describe("CHECK constraints", () => {
  const consent = (cols: string, vals: string) =>
    quietly(() =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "leaderboard_consents" ("id",${cols}) VALUES ('${randomUUID()}',${vals})`
      )
    );
  const reject = (p: Promise<unknown>, name: RegExp) => expect(p).rejects.toThrow(name);

  it("holds exactly one viewer kind per consent", async () => {
    const a = await user();
    const remote = await prisma.leaderboardRemote.create({
      data: { userId: a, origin: "o", channel: randomUUID(), username: "u", displayName: "U" },
    });
    await reject(consent('"owner_id"', `'${a}'`), /leaderboard_consents_one_viewer/);
    await reject(
      consent('"owner_id","viewer_id","remote_id"', `'${a}','${a}','${remote.id}'`),
      /leaderboard_consents_one_viewer/
    );
    await consent('"owner_id","remote_id"', `'${a}','${remote.id}'`);
  });

  it("holds a known status per consent", async () => {
    const a = await user();
    await reject(
      consent('"owner_id","viewer_id","status"', `'${a}','${a}','maybe'`),
      /leaderboard_consents_status/
    );
  });

  it("holds exactly one member kind per board member", async () => {
    const a = await user();
    const board = await prisma.leaderboardBoard.create({ data: { userId: a, name: "b" } });
    await reject(
      quietly(() =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "leaderboard_board_members" ("id","board_id") VALUES ('${randomUUID()}','${board.id}')`
        )
      ),
      /leaderboard_board_members_one_member/
    );
  });
});
