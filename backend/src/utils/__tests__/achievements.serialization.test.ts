import { checkAndUpdateAchievements } from "../achievements";
import { prisma } from "../../db";

jest.mock("../../db", () => ({
  prisma: {
    achievement: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    userAchievement: { findMany: jest.fn() },
  },
}));

jest.mock("../logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * Forgejo #39. A re-check re-evaluates every achievement inside one long
 * transaction, and ten of the sixteen call sites do not await it. Two runs for
 * the same user overlap easily — save a flight while a place tick is still
 * running — and the suite showed both halves of the consequence: an `upsert` on
 * `(user_id, achievement_id)` failing its unique constraint, and a
 * `40P01 deadlock detected` between two of these transactions.
 *
 * What has to hold is an ORDERING property, so it is asserted as one: while a
 * run for a user is in flight, a second must not have started. Asserting on the
 * absence of a Postgres error instead would pass on a machine that happened not
 * to interleave, which is exactly how this survived until a batch run caught it.
 *
 * The first Prisma call of a run stands in for "a run has begun". What the run
 * does after that gate is beside the point here and is left to fail — mocking
 * the whole data layer would make this test about the mock rather than about
 * the ordering, and it is the ordering that regressed.
 */
const mockedFindMany = prisma.achievement.findMany as jest.MockedFunction<
  typeof prisma.achievement.findMany
>;

describe("achievement re-checks are serialised per user", () => {
  afterEach(() => jest.clearAllMocks());

  it("does not start a second run for the same user while one is in flight", async () => {
    let concurrent = 0;
    let peak = 0;
    const releases: Array<() => void> = [];

    mockedFindMany.mockImplementation((() => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      // Hold the "transaction" open until the test lets go, the way a long
      // re-check holds one open past the response.
      return new Promise((resolve) => {
        releases.push(() => {
          concurrent -= 1;
          resolve([]);
        });
      });
    }) as never);

    const swallow = () => undefined;
    const first = checkAndUpdateAchievements("user-1").catch(swallow);
    const second = checkAndUpdateAchievements("user-1").catch(swallow);
    await new Promise((r) => setImmediate(r));

    expect(releases).toHaveLength(1); // the second run has not begun

    releases[0]();
    await first;
    await new Promise((r) => setImmediate(r));

    expect(releases).toHaveLength(2); // now it has
    releases[1]();
    await second;

    expect(peak).toBe(1);
  });

  it("still runs different users at the same time", async () => {
    let concurrent = 0;
    let peak = 0;
    const releases: Array<() => void> = [];

    mockedFindMany.mockImplementation((() => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      return new Promise((resolve) => {
        releases.push(() => {
          concurrent -= 1;
          resolve([]);
        });
      });
    }) as never);

    const swallow = () => undefined;
    const a = checkAndUpdateAchievements("user-a").catch(swallow);
    const b = checkAndUpdateAchievements("user-b").catch(swallow);
    await new Promise((r) => setImmediate(r));

    // The contention is per user, so the fix must be too — serialising everyone
    // would turn one slow account into a queue for the whole instance.
    expect(peak).toBe(2);

    releases.forEach((release) => release());
    await Promise.all([a, b]);
  });

  it("lets the queue continue after a run fails", async () => {
    // A rejected run must not wedge every later re-check for that user.
    mockedFindMany.mockRejectedValue(new Error("deadlock detected") as never);

    await expect(checkAndUpdateAchievements("user-2")).rejects.toThrow(/deadlock/);
    // The point: the queue is not wedged. A second call must still REACH the
    // data layer rather than inherit the first one's rejection and never run.
    await expect(checkAndUpdateAchievements("user-2")).rejects.toThrow(/deadlock/);
    expect(mockedFindMany).toHaveBeenCalledTimes(2);
  });
});
