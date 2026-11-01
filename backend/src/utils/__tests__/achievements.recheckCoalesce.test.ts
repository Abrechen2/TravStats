import { recheckAchievements } from "../achievements";
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

const mockedFindMany = prisma.achievement.findMany as jest.MockedFunction<
  typeof prisma.achievement.findMany
>;

/**
 * Forgejo #345. The station editor saves on every pause, and every write queued
 * its own full achievement run behind the previous one: 20 edits, 20 runs. The
 * first Prisma call of a run (`achievement.findMany`) stands in for "a run has
 * begun"; what the run does after it is left to fail, as in the serialisation
 * test.
 */
describe("after-write achievement rechecks coalesce per user", () => {
  afterEach(() => jest.clearAllMocks());

  it("runs at most one follow-up for 20 writes that arrive during a run", async () => {
    let release: () => void = () => undefined;
    mockedFindMany.mockImplementationOnce(
      (() =>
        new Promise((_resolve, reject) => {
          release = () => reject(new Error("stop"));
        })) as never
    );
    mockedFindMany.mockRejectedValue(new Error("stop"));

    const first = recheckAchievements("coalesce-u1", "PUT /a");
    const rest = Array.from({ length: 19 }, (_, i) =>
      recheckAchievements("coalesce-u1", `PUT /${i}`)
    );
    await new Promise((r) => setImmediate(r));
    expect(mockedFindMany).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, ...rest]);

    expect(mockedFindMany).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh run for a write after the previous loop has finished", async () => {
    mockedFindMany.mockRejectedValue(new Error("stop"));
    await recheckAchievements("coalesce-u2", "PUT /a");
    await recheckAchievements("coalesce-u2", "PUT /b");
    expect(mockedFindMany).toHaveBeenCalledTimes(2);
  });
});
