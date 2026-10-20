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
      details: { railway_class: [[0, 1, "rail"]] },
      points: { coordinates: points },
      snapped_waypoints: { coordinates: snapped },
    },
  ],
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(railRouteCache.get).mockResolvedValue(null);
  jest.mocked(railRouteCache.put).mockResolvedValue(undefined);
  fetchMock = jest.spyOn(global, "fetch");
});
afterEach(() => jest.restoreAllMocks());

it("requests only railway tracks from the first attempt", async () => {
  fetchMock.mockResolvedValue(response(answer()));
  expect((await routeRailLine("https://routing.test", points)).ok).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = fetchMock.mock.calls[0][1];
  expect(request.method).toBe("POST");
  expect(JSON.parse(request.body)).toMatchObject({
    points,
    profile: "all_tracks",
    snap_preventions: [],
    details: ["railway_class"],
    "ch.disable": true,
    custom_model: { priority: [{ if: "railway_class != RAIL", multiply_by: "0" }] },
  });
});
it("refuses any station snap beyond 500 metres", async () => {
  fetchMock.mockResolvedValue(response(answer([[9, 51], points[1]])));
  expect(await routeRailLine("https://routing.test", points)).toEqual({
    ok: false,
    reason: "noRoute",
  });
  expect(railRouteCache.put).not.toHaveBeenCalled();
});
it.each(["tram", "subway", "missing", "incomplete", "remote", "chord"])(
  "rejects %s geometry before caching",
  async (kind) => {
    const body = answer();
    const path = body.paths[0];
    if (kind === "tram" || kind === "subway") path.details.railway_class[0][2] = kind;
    if (kind === "missing") path.details.railway_class = [];
    if (kind === "incomplete") path.details.railway_class[0][1] = 0;
    if (kind === "remote")
      path.points.coordinates = [
        [1, 1],
        [1.01, 1.01],
      ];
    const input: LonLat[] =
      kind === "chord"
        ? [
            [8, 50],
            [18, 55],
          ]
        : points;
    if (kind === "chord") {
      path.points.coordinates = input;
      path.snapped_waypoints.coordinates = input;
    }
    fetchMock.mockResolvedValue(response(body));
    expect((await routeRailLine("https://routing.test", input)).ok).toBe(false);
    expect(railRouteCache.put).not.toHaveBeenCalled();
  }
);
it("explicit refresh bypasses a persisted answer", async () => {
  jest.mocked(railRouteCache.get).mockResolvedValue([
    [1, 1],
    [2, 2],
  ]);
  fetchMock.mockResolvedValue(response(answer()));
  expect((await routeRailLine("https://routing.test", points, { refresh: true })).ok).toBe(true);
  expect(railRouteCache.get).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(railRouteCache.put).toHaveBeenCalledTimes(1);
});
it("refresh joins a live request without starting a second request", async () => {
  let finish!: (value: Response) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  const normal = routeRailLine("https://routing.test", points);
  await Promise.resolve();
  const refresh = routeRailLine("https://routing.test", points, { refresh: true });
  finish(response(answer()));
  expect(await refresh).toEqual(await normal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
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
