import { randomUUID } from "crypto";
import { createCustomOsrm } from "../../tour/routing/customOsrm";
import { routeLegGeometry } from "../../tour/routing/routeLeg";
import * as budget from "../../tour/routing/providerBudget";
jest.mock("../../tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
}));
// The demo gate reads the account from the database first; under fake timers
// that query never settles, so the test supplies the answer itself.
jest.mock("../../../utils/sharedDemo", () => ({
  isSharedDemoUser: jest.fn().mockResolvedValue(false),
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

it("shares one actual road calculation across ten buses and a roadtrip", async () => {
  const fetchImpl = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: 180000,
              duration: 9000,
              geometry: {
                coordinates: [
                  [ends.depLon, ends.depLat],
                  [ends.arrLon, ends.arrLat],
                ],
              },
            },
          ],
        })
      )
  );
  const provider = createCustomOsrm(`https://${randomUUID()}.test`, fetchImpl);
  (resolveRouteProvider as jest.Mock).mockResolvedValue(provider);
  const spend = jest.spyOn(budget, "takeProviderCall");
  try {
    const buses = await Promise.all(
      Array.from({ length: 10 }, () => fetchBusLine("repeat-bus-test", ends))
    );
    expect(buses.every((b) => b.geometrySource === "road")).toBe(true);
    const trip = await routeLegGeometry(provider, {
      from: { lon: ends.depLon, lat: ends.depLat },
      to: { lon: ends.arrLon, lat: ends.arrLat },
      mode: "road",
      vehicle: "car",
    });
    expect(trip.source).toBe("routed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(spend).toHaveBeenCalledTimes(1);
  } finally {
    spend.mockRestore();
  }
});
