import {
  MAX_REMEMBERED_MISSES,
  __rememberedMissCount,
  __resetOperatorMarkCachesForTests,
  rememberMiss,
} from "../operatorMarkService";

/**
 * Review of forgejo#323: the miss memory grew with every distinct name that
 * missed, and an entry expired only when the same name was asked again.
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

beforeEach(() => __resetOperatorMarkCachesForTests());

describe("the miss memory", () => {
  it("stays bounded however many distinct names miss", () => {
    for (let i = 0; i < MAX_REMEMBERED_MISSES * 3; i++) rememberMiss(`k${i}`, "noItem", 60_000);
    expect(__rememberedMissCount()).toBe(MAX_REMEMBERED_MISSES);
  });

  it("is swept of expired entries, not only when a name is asked again", () => {
    const now = jest.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000_000);
      for (let i = 0; i < 100; i++) rememberMiss(`old${i}`, "noItem", 1_000);
      expect(__rememberedMissCount()).toBe(100);
      now.mockReturnValue(1_000_000_000 + 11 * 60 * 1000);
      rememberMiss("fresh", "noItem", 60_000);
      expect(__rememberedMissCount()).toBe(1);
    } finally {
      now.mockRestore();
    }
  });
});
