import { describe, it, expect, vi } from "vitest";

vi.mock("./api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./api")>();
  return {
    ...mod,
    statsApi: {
      ...mod.statsApi,
      getAirlineRanking: vi.fn(),
      getCountryStats: vi.fn(),
    },
  };
});

import { statsApi } from "./api";

describe("statsApi new methods", () => {
  it("getAirlineRanking is defined", () => {
    expect(typeof statsApi.getAirlineRanking).toBe("function");
  });

  it("getCountryStats is defined", () => {
    expect(typeof statsApi.getCountryStats).toBe("function");
  });
});
