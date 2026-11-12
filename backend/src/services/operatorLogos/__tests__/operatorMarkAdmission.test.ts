import {
  MAX_COLD_IN_FLIGHT,
  PER_USER_COLD_LIMIT,
  __resetOperatorMarkCachesForTests,
  answerOperatorMark,
} from "../operatorMarkService";
import { lookupOperatorMark } from "../wikidataOperator";

/**
 * Review of forgejo#323: cold lookups were unbounded — hundreds of distinct
 * names each started up to two serial Wikimedia searches, and a request
 * waited for all of it.
 * The lookup itself is mocked here; its HTTP failure paths are pinned in
 * `operatorMark.test.ts`.
 */
jest.mock("../wikidataOperator", () => ({ lookupOperatorMark: jest.fn() }));
jest.mock("../../instanceSettingsService", () => ({
  getInstanceSettings: async () => ({ operatorLogosOpenDataEnabled: true }),
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const lookup = lookupOperatorMark as jest.MockedFunction<typeof lookupOperatorMark>;
const never = (): ReturnType<typeof lookupOperatorMark> => new Promise(() => undefined);

beforeEach(() => {
  __resetOperatorMarkCachesForTests();
  lookup.mockReset();
});

describe("cold lookups are bounded", () => {
  it("a request waits only until its deadline, then answers pending", async () => {
    lookup.mockImplementation(never);
    const started = Date.now();
    const answer = await answerOperatorMark("ferry", "Slow Ferries", { waitMs: 50 });
    expect(answer).toEqual({ mark: null, pending: true });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("past the instance-wide cap a new name starts nothing and answers pending", async () => {
    lookup.mockImplementation(never);
    for (let i = 0; i < MAX_COLD_IN_FLIGHT; i++) {
      await answerOperatorMark("bus", `Busline ${i}`, { waitMs: 1 });
    }
    expect(lookup).toHaveBeenCalledTimes(MAX_COLD_IN_FLIGHT);
    const answer = await answerOperatorMark("bus", "One more", { waitMs: 1 });
    expect(answer.pending).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(MAX_COLD_IN_FLIGHT);
  });

  it("one user may start only so many cold lookups per window", async () => {
    lookup.mockResolvedValue({ ok: false, reason: "noItem" });
    for (let i = 0; i < PER_USER_COLD_LIMIT; i++) {
      await answerOperatorMark("bus", `Company ${i}`, { userId: "u1" });
    }
    expect(lookup).toHaveBeenCalledTimes(PER_USER_COLD_LIMIT);
    const refused = await answerOperatorMark("bus", "Company over", { userId: "u1" });
    expect(refused.pending).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(PER_USER_COLD_LIMIT);
    // Someone else is not held up by that user.
    await answerOperatorMark("bus", "Company over", { userId: "u2" });
    expect(lookup).toHaveBeenCalledTimes(PER_USER_COLD_LIMIT + 1);
  });
});
