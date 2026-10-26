import { probeRailRouting, routeRailLine } from "../openRailRouting";
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
    custom_model: {
      priority: [
        { if: "!(railway_class == RAIL || railway_class == NARROW_GAUGE)", multiply_by: "0" },
      ],
    },
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

describe("a tram or U-Bahn ride (tester report 2026-10-25)", () => {
  const answerOf = (railwayClass: string) => {
    const body = answer();
    body.paths[0].details.railway_class[0][2] = railwayClass as "rail";
    return body;
  };
  const bodies = () => fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
  const missingProfile = (name: string) =>
    response(
      {
        message: `The requested profile '${name}' does not exist.\nAvailable profiles: [all_tracks]`,
      },
      400
    );

  it.each([
    ["tram", "tram", "tram"],
    ["metro", "subway", "subway"],
    ["metro", "subway", "light_rail"],
  ] as const)("routes a %s ride with the %s profile", async (mode, profile, railwayClass) => {
    fetchMock.mockResolvedValue(response(answerOf(railwayClass)));
    expect((await routeRailLine("https://routing.test", points, { mode })).ok).toBe(true);
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0].profile).toBe(profile);
    expect(bodies()[0]).not.toHaveProperty("custom_model");
  });

  it.each([undefined, "rail"] as const)(
    "routes mode %s over all_tracks, rail only",
    async (mode) => {
      fetchMock.mockResolvedValue(response(answer()));
      expect((await routeRailLine("https://routing.test", points, { mode })).ok).toBe(true);
      expect(bodies()[0]).toMatchObject({
        profile: "all_tracks",
        custom_model: {
          priority: [
            { if: "!(railway_class == RAIL || railway_class == NARROW_GAUGE)", multiply_by: "0" },
          ],
        },
      });
    }
  );

  it("accepts a narrow-gauge train (RhB, Harz) and still refuses light rail for a train", async () => {
    fetchMock.mockResolvedValueOnce(response(answerOf("narrow_gauge")));
    expect((await routeRailLine("https://routing.test", points)).ok).toBe(true);
    fetchMock.mockResolvedValueOnce(response(answerOf("light_rail")));
    expect((await routeRailLine("https://routing.test", points, { refresh: true })).ok).toBe(false);
  });

  it("refuses a tram profile's answer that runs over mainline track", async () => {
    fetchMock.mockResolvedValue(response(answerOf("rail")));
    expect((await routeRailLine("https://routing.test", points, { mode: "tram" })).ok).toBe(false);
    expect(railRouteCache.put).not.toHaveBeenCalled();
  });

  it("falls back to all_tracks restricted to the tram network when the profile is missing", async () => {
    fetchMock
      .mockResolvedValueOnce(missingProfile("tram"))
      .mockResolvedValueOnce(response(answerOf("light_rail")));
    expect((await routeRailLine("https://routing.test", points, { mode: "tram" })).ok).toBe(true);
    expect(bodies()).toHaveLength(2);
    expect(bodies()[1]).toMatchObject({
      profile: "all_tracks",
      "ch.disable": true,
      custom_model: {
        priority: [
          {
            if: "!(railway_class == TRAM || railway_class == LIGHT_RAIL)",
            multiply_by: "0",
          },
        ],
      },
    });
  });

  it("restricts the U-Bahn fallback to subway and light rail", async () => {
    fetchMock
      .mockResolvedValueOnce(missingProfile("subway"))
      .mockResolvedValueOnce(response(answerOf("subway")));
    expect((await routeRailLine("https://routing.test", points, { mode: "metro" })).ok).toBe(true);
    expect(bodies()[1].custom_model.priority[0].if).toBe(
      "!(railway_class == SUBWAY || railway_class == LIGHT_RAIL)"
    );
  });

  it("names an instance that refuses the fallback, and never asks plain all_tracks", async () => {
    fetchMock.mockResolvedValueOnce(missingProfile("tram")).mockResolvedValueOnce(
      response(
        {
          message:
            "The 'custom_model' parameter is currently not supported for speed mode, you need to disable speed mode with `ch.disable=true`.",
        },
        400
      )
    );
    expect(await routeRailLine("https://routing.test", points, { mode: "tram" })).toEqual({
      ok: false,
      reason: "modeUnsupported",
    });
    for (const body of bodies())
      if (body.profile === "all_tracks") expect(body.custom_model).toBeDefined();
  });

  it.each([401, 403, 429])(
    "treats a fallback refused with HTTP %s as the router being unavailable, not as unsupported",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(missingProfile("tram"))
        .mockResolvedValueOnce(response({ message: "slow down" }, status));
      expect(await routeRailLine("https://routing.test", points, { mode: "tram" })).toEqual({
        ok: false,
        reason: "unavailable",
      });
    }
  );

  it("keeps a missing connection on the tram network a missing connection", async () => {
    fetchMock
      .mockResolvedValueOnce(missingProfile("tram"))
      .mockResolvedValueOnce(response({ message: "Connection between locations not found" }, 400));
    expect(await routeRailLine("https://routing.test", points, { mode: "tram" })).toEqual({
      ok: false,
      reason: "noRoute",
    });
  });

  it("caches a tram line apart from a train line between the same stations", async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      response(answerOf(JSON.parse(init.body).profile === "tram" ? "tram" : "rail"))
    );
    await routeRailLine("https://routing.test", points);
    await routeRailLine("https://routing.test", points, { mode: "tram" });
    await routeRailLine("https://routing.test", points, { mode: "metro" });
    const keys = jest.mocked(railRouteCache.get).mock.calls.map(([key]) => key);
    expect(new Set(keys).size).toBe(3);
  });
});

it.each([
  [["all_tracks", "tram", "subway"], { tram: true, subway: true }],
  [["all_tracks", "tramtrain"], { tram: false, subway: false }],
  [["all_tracks", "subway"], { tram: false, subway: true }],
])("the probe says which local-transit profiles %j carries", async (names, modeProfiles) => {
  fetchMock.mockResolvedValue(
    response({ profiles: names.map((name) => ({ name })), data_date: "2026-10-09" })
  );
  expect(await probeRailRouting("https://routing.test")).toEqual({
    ok: true,
    profile: "all_tracks",
    dataDate: "2026-10-09",
    modeProfiles,
  });
});

it.each([["1970-01-01T00:00:00Z"], ["1970-01-01"], ["not a date"]])(
  "the probe reports no map date for %j — an extract without one says epoch 0",
  async (dataDate) => {
    fetchMock.mockResolvedValue(
      response({ profiles: [{ name: "all_tracks" }], data_date: dataDate })
    );
    expect(await probeRailRouting("https://routing.test")).toMatchObject({
      ok: true,
      dataDate: null,
    });
  }
);
