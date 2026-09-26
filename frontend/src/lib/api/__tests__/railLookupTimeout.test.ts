import { describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("../client", () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

import { railApi } from "../rail";
import { API_TIMEOUTS } from "../../../config/constants";

/**
 * Review 2026-09-26, finding 2: the lookup ran on the client's 10 s default
 * while the server could take far longer, so a slow provider ended in a bare
 * "the search failed". The server now stops at 20 s and says who was slow;
 * this call must wait for that answer.
 */
describe("railApi.lookup", () => {
  it("waits longer than the server's 20 s lookup budget", async () => {
    get.mockResolvedValue({ data: { data: { match: null, attempts: [] } } });
    await railApi.lookup({ trainNumber: "696", date: "2026-09-26", fromStationId: 1 });
    const config = get.mock.calls[0][1] as { timeout?: number };
    expect(config.timeout).toBe(API_TIMEOUTS.RAIL_LOOKUP);
    expect(API_TIMEOUTS.RAIL_LOOKUP).toBeGreaterThan(20_000);
  });
});
