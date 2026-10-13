import { routeRailLine } from "../openRailRouting";
import { railRouteCache } from "../railRouteCache";
import type { LonLat } from "../railGeometryMath";

jest.mock("../../instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
jest.mock("../railRouteCache", () => ({
  ...jest.requireActual("../railRouteCache"),
  railRouteCache: { get: jest.fn(), put: jest.fn() },
}));

const points: LonLat[] = [
  [8.663785, 50.107149],
  [8.684, 50.12],
];
const answer = (snapped = points) => ({
  paths: [
    {
      distance: 2500,
      points: { coordinates: points },
      snapped_waypoints: { coordinates: snapped },
    },
  ],
});
const disconnected = {
  hints: [{ details: "com.graphhopper.util.exceptions.ConnectionNotFoundException" }],
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(railRouteCache.get).mockResolvedValue(null);
  jest.mocked(railRouteCache.put).mockResolvedValue(undefined);
  fetchMock = jest.spyOn(global, "fetch");
});
afterEach(() => jest.restoreAllMocks());

it("rescues Frankfurt's disconnected snap using the same coordinates and one shared deadline", async () => {
  fetchMock
    .mockResolvedValueOnce(response(disconnected, 400))
    .mockResolvedValueOnce(response(answer()));
  expect((await routeRailLine("https://routing.test", points)).ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const first = fetchMock.mock.calls[0][1];
  const retry = fetchMock.mock.calls[1][1];
  expect(retry.signal).toBe(first.signal);
  expect(retry.method).toBe("POST");
  expect(JSON.parse(retry.body)).toMatchObject({
    points,
    profile: "all_tracks",
    "ch.disable": true,
    custom_model: { priority: [{ if: "railway_class != RAIL", multiply_by: "0" }] },
  });
});

it("refuses a retry that moves any station more than 500 metres", async () => {
  fetchMock
    .mockResolvedValueOnce(response(disconnected, 400))
    .mockResolvedValueOnce(response(answer([[9, 51], points[1]])));
  expect(await routeRailLine("https://routing.test", points)).toEqual({
    ok: false,
    reason: "noRoute",
  });
});

it.each([400, 503])("does not retry unrelated HTTP %s responses", async (status) => {
  fetchMock.mockResolvedValue(response({ message: "failed" }, status));
  expect((await routeRailLine("https://routing.test", points)).ok).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("uses a persisted route without any provider request", async () => {
  jest.mocked(railRouteCache.get).mockResolvedValue(points);
  expect(await routeRailLine("https://routing.test", points)).toEqual({ ok: true, line: points });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("coalesces concurrent identical saves and returns independent lines", async () => {
  fetchMock.mockResolvedValue(response(answer()));
  const [a, b] = await Promise.all([
    routeRailLine("https://routing.test", points),
    routeRailLine("https://routing.test/", points),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(a).toEqual(b);
  if (a.ok && b.ok) {
    a.line[0][0] = 0;
    expect(b.line[0][0]).toBe(points[0][0]);
  }
});

it("does not cache failures and retries on the next save", async () => {
  fetchMock.mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(answer()));
  expect((await routeRailLine("https://routing.test", points)).ok).toBe(false);
  expect((await routeRailLine("https://routing.test", points)).ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
