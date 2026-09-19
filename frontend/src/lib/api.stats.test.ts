import { describe, it, expect, vi } from "vitest";

vi.mock("./api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./api")>();
  return {
    ...mod,
    statsApi: {
      ...mod.statsApi,
      getCountryStats: vi.fn(),
    },
  };
});

import { statsApi } from "./api";

// The `getAirlineRanking` case went with the wrapper (forgejo#49): the
// statistics page reads that section through `getStatsPage`, and nothing else
// in this app called it. `getCountryStats` stayed because `useDomainStats`
// still does, on every tab.
describe("statsApi new methods", () => {
  it("getCountryStats is defined", () => {
    expect(typeof statsApi.getCountryStats).toBe("function");
  });
});
