import { describe, it, expect, vi, afterEach } from "vitest";

import { api } from "../client";
import { API_TIMEOUTS } from "../../../config/constants";
import { openDataApi } from "../openData";

/**
 * The browser must not give up before the server (silent-failure fixes,
 * 2026-09-26). The server allows Overpass 20 s (enrich) and 25 s (nearby);
 * the default client timeout was 10 s, so the UI reported a failure — or
 * "not found" — while the server was still asking.
 */
const SERVER_OVERPASS_BUDGET_MS = { enrich: 20_000, nearby: 25_000 };
const SERVER_WEATHER_BUDGET_MS = 8_000;

describe("open data client timeouts cover the server's budget", () => {
  afterEach(() => vi.restoreAllMocks());

  it("enrich waits longer than the server's Overpass call", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} } as never);
    await openDataApi.enrichLodging("l1");
    const config = post.mock.calls[0][2] as { timeout?: number };
    expect(config.timeout).toBeGreaterThan(SERVER_OVERPASS_BUDGET_MS.enrich);
  });

  it("nearby waits longer than the server's Overpass call", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { places: [] } } as never);
    await openDataApi.nearbyLodgings(52.5, 13.4, 0.5);
    const config = get.mock.calls[0][1] as { timeout?: number };
    expect(config.timeout).toBeGreaterThan(SERVER_OVERPASS_BUDGET_MS.nearby);
  });

  it("a single weather refresh waits longer than the server's Open-Meteo call", async () => {
    const post = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: { entry: {}, weatherOutcome: "observed" } } as never);
    await openDataApi.refreshEntryWeather("t1", "e1");
    const config = post.mock.calls[0][2] as { timeout?: number };
    expect(config.timeout).toBeGreaterThan(SERVER_WEATHER_BUDGET_MS);
    expect(API_TIMEOUTS.OPEN_DATA_WEATHER).toBe(config.timeout);
  });
});
