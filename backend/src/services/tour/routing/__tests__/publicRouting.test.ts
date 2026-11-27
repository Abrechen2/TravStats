import { describe, it, expect } from "@jest/globals";
import {
  createPublicRouting,
  createRateLimiter,
  PUBLIC_ROUTING_BASE,
  PUBLIC_ROUTING_MIN_INTERVAL_MS,
  PUBLIC_ROUTING_USER_AGENT,
} from "../publicRouting";

const okBody = {
  routes: [
    {
      geometry: {
        coordinates: [
          [12, 48],
          [11, 48],
        ],
      },
      distance: 72000,
      duration: 3300,
    },
  ],
};
const req = { from: { lat: 48, lon: 12 }, to: { lat: 48, lon: 11 }, mode: "road" as const };

describe("public routing fallback", () => {
  it("keeps the conservative interval between requests even when they arrive together", async () => {
    let clock = 0;
    const slept: number[] = [];
    const limit = createRateLimiter(
      PUBLIC_ROUTING_MIN_INTERVAL_MS,
      () => clock,
      async (ms) => {
        slept.push(ms);
        clock += ms;
      }
    );
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map(() => limit(async () => starts.push(clock))));
    expect(starts).toEqual([0, 1100, 2200]);
    expect(slept).toEqual([1100, 1100]);
  });

  it("keeps the limiter running after a failed request", async () => {
    const limit = createRateLimiter(0);
    await expect(limit(() => Promise.reject(new Error("down")))).rejects.toThrow("down");
    await expect(limit(async () => "next")).resolves.toBe("next");
  });

  it("asks the FOSSGIS car instance with a User-Agent that names no person, for a road leg only", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers ?? {} });
      return { ok: true, status: 200, json: async () => okBody };
    }) as unknown as typeof fetch;
    const provider = createPublicRouting(fetchImpl, createRateLimiter(0));
    const result = await provider.route(req);
    expect(result).toMatchObject({ distanceKm: 72, drivingMinutes: 55 });
    expect(calls[0].url.startsWith(PUBLIC_ROUTING_BASE + "/route/v1/car/")).toBe(true);
    expect(calls[0].headers["User-Agent"]).toBe(PUBLIC_ROUTING_USER_AGENT);
    expect(PUBLIC_ROUTING_USER_AGENT).not.toMatch(/@|\.de|dennis/i);
    // The instance is the car profile: a foot or bike leg is not sent at all.
    expect(await provider.route({ ...req, mode: "foot" })).toBeNull();
    expect(await provider.route({ ...req, vehicle: "bicycle" })).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
