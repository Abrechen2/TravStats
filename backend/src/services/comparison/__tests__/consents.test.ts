import { randomUUID } from "crypto";
import { prisma, type DbTransaction } from "../../../db";
import logger from "../../../utils/logger";
import type { LeaderboardScope } from "../../../schemas/comparison";
import {
  acceptConsent,
  declineConsent,
  endLocal,
  listPeople,
  requestComparison,
  updateScope,
} from "../consents";

const SCOPE: LeaderboardScope = { groups: ["distance", "trips"], domains: ["flight"], year: null };
const users: Array<{ id: string; username: string }> = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `lb-c-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u);
  return u;
}
/** What every leaderboard reader asks: an accepted consent from the owner to this viewer. */
async function sees(viewerId: string, ownerId: string): Promise<boolean> {
  const n = await prisma.leaderboardConsent.count({
    where: { ownerId, viewerId, status: "accepted", owner: { isActive: true } },
  });
  return n > 0;
}
const listed = async (userId: string, otherId: string) =>
  (await listPeople(userId)).people.some((p) => p.person.key === `local:${otherId}`);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.$disconnect();
});

it("asks the other side without showing them the asker's numbers yet", async () => {
  const [a, b] = [await user(), await user()];
  const view = await requestComparison(a.id, b.username.toUpperCase(), SCOPE);
  expect(view).toMatchObject({
    person: { key: `local:${b.id}`, kind: "local", origin: null },
    mine: { status: "pending", scope: SCOPE },
    theirs: { status: "pending" },
  });
  const forB = await listPeople(b.id);
  expect(forB.requests).toEqual([
    expect.objectContaining({ person: expect.objectContaining({ key: `local:${a.id}` }) }),
  ]);
  // Controller ruling: until Ben answers, Anna is neither readable by him nor on his list.
  expect(await sees(b.id, a.id)).toBe(false);
  expect(await sees(a.id, b.id)).toBe(false);
  expect(forB.people).toEqual([]);
  expect(await listed(a.id, b.id)).toBe(true);
});

it("refuses self, unknown names and a second request with named codes", async () => {
  const [a, b] = [await user(), await user()];
  await expect(requestComparison(a.id, a.username, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_SELF",
  });
  await expect(requestComparison(a.id, "nobody-by-that-name", SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_USER_NOT_FOUND",
  });
  await requestComparison(a.id, b.username, SCOPE);
  await expect(requestComparison(a.id, b.username, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_DUPLICATE",
  });
});

it("a decline leaves nothing visible either way, and the pair may be asked again", async () => {
  const [a, b] = [await user(), await user()];
  const asked = await requestComparison(a.id, b.username, SCOPE);
  const request = (await listPeople(b.id)).requests[0];
  // The asker cannot answer her own question, nor the asked side's.
  await expect(acceptConsent(a.id, asked.mine!.consentId, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_NOT_PENDING",
  });
  await expect(acceptConsent(a.id, request.consentId, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_NOT_FOUND",
  });
  await declineConsent(b.id, request.consentId);
  await expect(declineConsent(b.id, request.consentId)).rejects.toMatchObject({
    code: "COMPARISON_NOT_PENDING",
  });
  expect(await sees(b.id, a.id)).toBe(false);
  expect(await sees(a.id, b.id)).toBe(false);
  expect(await listed(a.id, b.id)).toBe(false);
  expect(await listed(b.id, a.id)).toBe(false);
  expect((await listPeople(b.id)).requests).toEqual([]);

  await requestComparison(a.id, b.username, SCOPE);
  const again = (await listPeople(b.id)).requests[0];
  expect(again.person.key).toBe(`local:${a.id}`);
  expect(await sees(b.id, a.id)).toBe(false);
  const accepted = await acceptConsent(b.id, again.consentId, { ...SCOPE, year: 2025 });
  expect(accepted.mine).toMatchObject({ status: "accepted", scope: { year: 2025 } });
  expect(accepted.theirs).toEqual({ status: "accepted" });
  expect(await sees(b.id, a.id)).toBe(true);
  expect(await sees(a.id, b.id)).toBe(true);
  const forA = (await listPeople(a.id)).people[0];
  expect(forA.theirs).toEqual({ status: "accepted" });
  expect(forA.mine).toMatchObject({ status: "accepted", scope: SCOPE });
});

it("asking back someone who already asked answers their question", async () => {
  const [a, b] = [await user(), await user()];
  await requestComparison(a.id, b.username, SCOPE);
  const view = await requestComparison(b.id, a.username, { ...SCOPE, year: 2024 });
  expect(view).toMatchObject({
    mine: { status: "accepted", scope: { year: 2024 } },
    theirs: { status: "accepted" },
  });
  expect(await sees(a.id, b.id)).toBe(true);
  expect(await sees(b.id, a.id)).toBe(true);
  expect((await listPeople(b.id)).requests).toEqual([]);
});

it("asking someone who already shares with you (a copied grant) takes effect at once", async () => {
  const [a, b] = [await user(), await user()];
  await prisma.leaderboardConsent.create({
    data: {
      ownerId: b.id,
      viewerId: a.id,
      status: "accepted",
      scope: SCOPE,
      decidedAt: new Date(),
    },
  });
  const view = await requestComparison(a.id, b.username, SCOPE);
  expect(view).toMatchObject({ mine: { status: "accepted" }, theirs: { status: "accepted" } });
  expect(await sees(b.id, a.id)).toBe(true);
  expect((await listPeople(b.id)).requests).toEqual([]);
});

it("a question restored from a backup is answered by each side on its own", async () => {
  const [a, b] = [await user(), await user()];
  // What restore.ts leaves behind: both directions pending, neither decided, scopes kept.
  for (const [ownerId, viewerId] of [
    [a.id, b.id],
    [b.id, a.id],
  ])
    await prisma.leaderboardConsent.create({
      data: { ownerId, viewerId, status: "pending", scope: SCOPE },
    });
  const request = (await listPeople(a.id)).requests[0];
  expect(request.person.key).toBe(`local:${b.id}`);
  await acceptConsent(a.id, request.consentId, SCOPE);
  expect(await sees(b.id, a.id)).toBe(true);
  expect(await sees(a.id, b.id)).toBe(false);
  expect((await listPeople(b.id)).requests).toHaveLength(1);
});

it("ends the comparison in both directions with one action", async () => {
  const [a, b] = [await user(), await user()];
  await requestComparison(a.id, b.username, SCOPE);
  await endLocal(b.id, a.id);
  const rows = await prisma.leaderboardConsent.findMany({
    where: {
      OR: [
        { ownerId: a.id, viewerId: b.id },
        { ownerId: b.id, viewerId: a.id },
      ],
    },
  });
  expect(rows.map((r) => r.status)).toEqual(["withdrawn", "withdrawn"]);
  expect((await listPeople(a.id)).people).toEqual([]);
  expect((await listPeople(b.id)).requests).toEqual([]);
  await expect(endLocal(b.id, a.id)).rejects.toMatchObject({ code: "COMPARISON_NOT_FOUND" });
});

it("lists a person whose stored scope no longer parses instead of failing the page", async () => {
  const [a, b] = [await user(), await user()];
  await requestComparison(a.id, b.username, SCOPE);
  await acceptConsent(b.id, (await listPeople(b.id)).requests[0].consentId, SCOPE);
  await prisma.leaderboardConsent.updateMany({
    where: { ownerId: a.id, viewerId: b.id },
    data: { scope: { groups: ["bogus"], domains: [], year: "x" } },
  });
  const warn = jest.spyOn(logger, "warn");
  const people = (await listPeople(a.id)).people;
  expect(people[0].mine).toMatchObject({ status: "accepted", scope: null });
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "comparison_scope_invalid" }),
    expect.any(String)
  );
  warn.mockRestore();
});

/**
 * Runs the next `prisma.$transaction` with `between()` injected after its second consent read:
 * a writer that moves the pair after the reads and before the writes.
 */
function interleave(between: () => Promise<unknown>) {
  const real = prisma.$transaction.bind(prisma) as unknown as (
    fn: (tx: DbTransaction) => Promise<unknown>
  ) => Promise<unknown>;
  let reads = 0;
  const bound = <T extends object>(target: T, key: string | symbol) => {
    const v = Reflect.get(target, key) as unknown;
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  };
  jest.spyOn(prisma, "$transaction").mockImplementationOnce(((
    fn: (tx: DbTransaction) => Promise<unknown>
  ) =>
    real((tx) =>
      fn(
        new Proxy(tx, {
          get(t, key) {
            if (key !== "leaderboardConsent") return bound(t, key);
            return new Proxy(t.leaderboardConsent, {
              get(d, m) {
                if (m !== "findUnique") return bound(d, m);
                return async (args: Parameters<typeof d.findUnique>[0]) => {
                  const row = await d.findUnique(args);
                  if (++reads === 2) await between();
                  return row;
                };
              },
            });
          },
        })
      )
    )) as never);
}

it("asking back does not revive an offer its asker took back meanwhile", async () => {
  const [a, b] = [await user(), await user()];
  await requestComparison(a.id, b.username, SCOPE);
  // Anna withdraws her offer after Ben's ask has read it, before it writes.
  interleave(() =>
    prisma.leaderboardConsent.updateMany({
      where: { ownerId: a.id, viewerId: b.id },
      data: { status: "withdrawn" },
    })
  );
  await expect(requestComparison(b.id, a.username, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_NOT_PENDING",
  });
  expect(await sees(a.id, b.id)).toBe(false);
  expect(await sees(b.id, a.id)).toBe(false);
  // Ben's own row rolled back with it: still Anna's open question, not a yes.
  expect(
    await prisma.leaderboardConsent.findFirst({ where: { ownerId: b.id, viewerId: a.id } })
  ).toMatchObject({ status: "pending", decidedAt: null });
});

it("two people asking each other at the same moment both succeed and end up comparing", async () => {
  const [a, b] = [await user(), await user()];
  const views = await Promise.all([
    requestComparison(a.id, b.username, SCOPE),
    requestComparison(b.id, a.username, SCOPE),
  ]);
  expect(views).toHaveLength(2);
  expect(await sees(a.id, b.id)).toBe(true);
  expect(await sees(b.id, a.id)).toBe(true);
});

it("a one-way share of the asker's own still lets her ask the other way", async () => {
  const [a, b] = [await user(), await user()];
  await prisma.leaderboardConsent.create({
    data: {
      ownerId: a.id,
      viewerId: b.id,
      status: "accepted",
      scope: SCOPE,
      decidedAt: new Date(),
    },
  });
  const view = await requestComparison(a.id, b.username, SCOPE);
  expect(view).toMatchObject({ mine: { status: "accepted" }, theirs: { status: "pending" } });
  expect((await listPeople(b.id)).requests).toEqual([
    expect.objectContaining({ person: expect.objectContaining({ key: `local:${a.id}` }) }),
  ]);
  await expect(requestComparison(a.id, b.username, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_DUPLICATE",
  });
});

it("changes the scope of an accepted consent only, never of an open offer or question", async () => {
  const [a, b] = [await user(), await user()];
  const asked = await requestComparison(a.id, b.username, SCOPE);
  const question = (await listPeople(b.id)).requests[0];
  await expect(updateScope(a.id, asked.mine!.consentId, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_NOT_FOUND",
  });
  await expect(updateScope(b.id, question.consentId, SCOPE)).rejects.toMatchObject({
    code: "COMPARISON_NOT_FOUND",
  });
  expect(await sees(b.id, a.id)).toBe(false);
  await acceptConsent(b.id, question.consentId, SCOPE);
  const changed = await updateScope(a.id, asked.mine!.consentId, { ...SCOPE, year: 2023 });
  expect(changed.mine).toMatchObject({ status: "accepted", scope: { year: 2023 } });
});
