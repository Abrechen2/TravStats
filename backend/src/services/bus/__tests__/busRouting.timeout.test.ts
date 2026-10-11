jest.mock("../../tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
}));

import { resolveRouteProvider } from "../../tour/routing/resolveProvider";
import { BUS_ROUTE_TIMEOUT_MS, fetchBusLine } from "../busRouting";

const ends = { depLat: 37.5048, depLon: 127.0046, arrLat: 38.1911, arrLon: 128.5918 };

describe("fetchBusLine timeout", () => {
  afterEach(() => jest.useRealTimers());

  it("is bounded well under the client's 10 s", () => {
    expect(BUS_ROUTE_TIMEOUT_MS).toBeLessThanOrEqual(8_000);
  });

  it("a provider that never answers reads as provider_error after the timeout, not a hung save", async () => {
    jest.useFakeTimers();
    (resolveRouteProvider as jest.Mock).mockResolvedValue({
      id: "custom",
      route: () => new Promise(() => undefined),
    });
    const pending = fetchBusLine("user-1", ends);
    await jest.advanceTimersByTimeAsync(BUS_ROUTE_TIMEOUT_MS + 1);
    await expect(pending).resolves.toMatchObject({
      geometrySource: "straight",
      geometry: null,
      fallback: "provider_error",
    });
  });
});
