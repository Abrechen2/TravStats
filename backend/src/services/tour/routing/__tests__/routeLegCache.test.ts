import { createCustomOsrm } from "../customOsrm";
import { randomUUID } from "crypto";
import { routeLegGeometry } from "../routeLeg";
import type { RouteProvider, RouteRequest } from "../types";
const input: RouteRequest = { from: { lat: 50, lon: 8 }, to: { lat: 51, lon: 9 }, mode: "road" };
const good = {
  waypoints: [
    [8, 50],
    [9, 51],
  ] as [number, number][],
  distanceKm: 150,
  drivingMinutes: 120,
};
function provider() {
  return { id: "custom" as const, cacheIdentity: randomUUID(), route: jest.fn(async () => good) };
}
it("shares sequential and simultaneous routes across provider instances without charging cache hits", async () => {
  const p = provider();
  const spend = jest.fn(() => true);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => routeLegGeometry({ ...p }, input, spend))
  );
  expect(p.route).toHaveBeenCalledTimes(1);
  expect(spend).toHaveBeenCalledTimes(1);
  results[0].waypoints![0][0] = 0;
  expect((await routeLegGeometry({ ...p }, input, spend)).waypoints).toEqual(good.waypoints);
  expect(spend).toHaveBeenCalledTimes(1);
});
it("separates directions, vehicle profiles, modes and configured routers", async () => {
  const p = provider();
  await routeLegGeometry(p, input);
  await routeLegGeometry(p, { ...input, vehicle: "bicycle" });
  await routeLegGeometry(p, { ...input, mode: "foot" });
  await routeLegGeometry({ ...p, cacheIdentity: randomUUID() }, input);
  await routeLegGeometry(p, { ...input, from: input.to, to: input.from });
  expect(p.route).toHaveBeenCalledTimes(5);
});
it("does not freeze transient failures or invalid geometry", async () => {
  const route = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      ...good,
      waypoints: [
        [0, 0],
        [1, 1],
      ],
    })
    .mockResolvedValue(good);
  const p: RouteProvider = { ...provider(), route };
  expect((await routeLegGeometry(p, input)).source).toBe("straight");
  expect((await routeLegGeometry(p, input)).source).toBe("straight");
  expect((await routeLegGeometry(p, input)).source).toBe("routed");
  expect((await routeLegGeometry(p, input)).source).toBe("routed");
  expect(route).toHaveBeenCalledTimes(3);
});
it("does not call the provider on exhausted budget, but still allows an existing route", async () => {
  const p = provider();
  expect((await routeLegGeometry(p, input, () => false)).fallbackReason).toBe("rate_limited");
  expect(p.route).not.toHaveBeenCalled();
  await routeLegGeometry(p, input, () => true);
  expect((await routeLegGeometry(p, input, () => false)).source).toBe("routed");
});

it("shares identical actual road profiles between bus and car trips", async () => {
  const fetchImpl = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          code: "Ok",
          routes: [{ distance: 150000, duration: 7200, geometry: { coordinates: good.waypoints } }],
        })
      )
  );
  const url = `https://${randomUUID()}.test`;
  await routeLegGeometry(createCustomOsrm(url, fetchImpl), input);
  await routeLegGeometry(createCustomOsrm(url, fetchImpl), { ...input, vehicle: "car" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it.each([
  {
    waypoints: [
      [8, 50],
      [181, 50],
      [9, 51],
    ],
  },
  {
    waypoints: [
      [8, 50],
      [8.5, 91],
      [9, 51],
    ],
  },
  { drivingMinutes: -1 },
  { drivingMinutes: NaN },
  { drivingMinutes: Infinity },
])(
  "rejects invalid road results on the first response and never caches them: %j",
  async (invalid) => {
    const route = jest
      .fn()
      .mockResolvedValueOnce({ ...good, ...invalid })
      .mockResolvedValue(good);
    const p: RouteProvider = { ...provider(), route };
    expect(await routeLegGeometry(p, input)).toMatchObject({
      source: "straight",
      fallbackReason: "untrustworthy",
    });
    expect((await routeLegGeometry(p, input)).source).toBe("routed");
    expect((await routeLegGeometry(p, input)).source).toBe("routed");
    expect(route).toHaveBeenCalledTimes(2);
  }
);
