/**
 * The Dawarich client is the only place that knows Dawarich's REST shape, so
 * these tests pin that shape: the bare-array response, string coordinates,
 * second-precision timestamps, newest-first ordering, the header auth form,
 * and the error taxonomy the tester/routes depend on.
 *
 * Fixtures are shaped exactly like the real payload measured 2026-08-29
 * against Dawarich 1.9.2 (see the task-6 brief) — strings for lat/lon,
 * seconds for the timestamp, newest first — not a tidied-up version of it.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { createDawarichClient } from "../dawarichClient";
import { DawarichConnection, DawarichError } from "../errors";

const CONN: DawarichConnection = {
  baseUrl: "https://dawarich.lan",
  apiKey: "secret-key",
  source: "user",
};

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  jsonThrows?: boolean;
}

function fakeResponse({
  ok = true,
  status = 200,
  headers = {},
  body = null,
  jsonThrows = false,
}: FakeResponseInit = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok,
    status,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    json: async () => {
      if (jsonThrows) throw new Error("not json");
      return body;
    },
  } as unknown as Response;
}

/** Measured from a real point (task-6 brief). */
const REAL_POINT = {
  id: 170766,
  latitude: "47.82650243593231",
  longitude: "12.190313427831057",
  timestamp: 1788034040,
  altitude: 508,
  accuracy: 2,
  velocity: "10.30",
  track_id: 1212,
  lonlat: "POINT (12.19 47.82)",
  city: null,
  country: null,
};

const realFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("checkHealth", () => {
  it("GETs /api/v1/health with no auth header and captures the version header", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        fakeResponse({ body: { status: "ok" }, headers: { "x-dawarich-version": "1.9.2" } }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const health = await createDawarichClient(CONN).checkHealth();

    expect(health).toEqual({ reachable: true, version: "1.9.2" });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://dawarich.lan/api/v1/health");
    expect(options.headers).toBeUndefined();
  });

  it("returns a null version when the header is absent", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse({ body: { status: "ok" } })) as unknown as typeof fetch;

    await expect(createDawarichClient(CONN).checkHealth()).resolves.toEqual({
      reachable: true,
      version: null,
    });
  });

  it("maps a 500 to kind=unreachable", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse({ ok: false, status: 500 })) as unknown as typeof fetch;

    await expect(createDawarichClient(CONN).checkHealth()).rejects.toMatchObject({
      name: "DawarichError",
      kind: "unreachable",
      status: 500,
    });
  });

  it("maps a non-JSON body to kind=protocol", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse({ jsonThrows: true })) as unknown as typeof fetch;

    await expect(createDawarichClient(CONN).checkHealth()).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("maps an unexpected status payload to kind=protocol", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse({ body: { status: "degraded" } })) as unknown as typeof fetch;

    await expect(createDawarichClient(CONN).checkHealth()).rejects.toMatchObject({
      kind: "protocol",
    });
  });

  it("maps a network failure (e.g. connection refused) to kind=unreachable", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    await expect(createDawarichClient(CONN).checkHealth()).rejects.toMatchObject({
      kind: "unreachable",
    });
  });
});

describe("getPoints", () => {
  it("sends the Bearer header and the start_at/end_at/page/per_page params, never from/to", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(fakeResponse({ body: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const startAt = new Date("2026-08-25T00:00:00Z");
    const endAt = new Date("2026-08-25T23:59:59Z");
    await createDawarichClient(CONN).getPoints({ startAt, endAt });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/v1/points");
    expect(parsed.searchParams.get("start_at")).toBe(startAt.toISOString());
    expect(parsed.searchParams.get("end_at")).toBe(endAt.toISOString());
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("per_page")).toBe("1000");
    // Load-bearing: these are SILENTLY IGNORED by the real server, so the
    // client must never send them instead of start_at/end_at.
    expect(parsed.searchParams.has("from")).toBe(false);
    expect(parsed.searchParams.has("to")).toBe(false);
    expect(parsed.searchParams.has("start_date")).toBe(false);
    expect(parsed.searchParams.has("end_date")).toBe(false);
    expect(options.headers).toEqual({ Authorization: "Bearer secret-key" });
  });

  it("parses the real measured shape: string coords to numbers, seconds to ms", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse({ body: [REAL_POINT] })) as unknown as typeof fetch;

    const { points, truncated } = await createDawarichClient(CONN).getPoints({
      startAt: new Date("2026-08-25T00:00:00Z"),
      endAt: new Date("2026-08-25T23:59:59Z"),
    });

    expect(truncated).toBe(false);
    expect(points).toEqual([
      {
        id: 170766,
        latitude: 47.82650243593231,
        longitude: 12.190313427831057,
        timestampMs: 1788034040 * 1000,
        altitude: 508,
        accuracy: 2,
        velocity: 10.3,
        trackId: 1212,
      },
    ]);
  });

  it("sorts points ascending even though Dawarich answers newest first", async () => {
    // Measured order from the brief: 14:56:35, then 14:22:19, 14:22:17, 14:22:13.
    const newestFirst = [
      { ...REAL_POINT, id: 1, timestamp: 1000 + 3 },
      { ...REAL_POINT, id: 2, timestamp: 1000 + 2 },
      { ...REAL_POINT, id: 3, timestamp: 1000 + 1 },
      { ...REAL_POINT, id: 4, timestamp: 1000 + 0 },
    ];
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse({ body: newestFirst })) as unknown as typeof fetch;

    const { points } = await createDawarichClient(CONN).getPoints({
      startAt: new Date(0),
      endAt: new Date(),
    });

    // This assertion would fail (order 1,2,3,4) if the client handed points
    // onward in Dawarich's own newest-first response order.
    expect(points.map((p) => p.id)).toEqual([4, 3, 2, 1]);
    expect(points.map((p) => p.timestampMs)).toEqual([
      1000000, 1001000, 1002000, 1003000,
    ]);
  });

  it("rejects a point whose latitude/longitude cannot be parsed, dropping only that point", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      fakeResponse({
        body: [
          { ...REAL_POINT, id: 1, latitude: "not-a-number" },
          { ...REAL_POINT, id: 2 },
        ],
      }),
    ) as unknown as typeof fetch;

    const { points } = await createDawarichClient(CONN).getPoints({
      startAt: new Date(0),
      endAt: new Date(),
    });

    expect(points).toHaveLength(1);
    expect(points[0].id).toBe(2);
  });

  it("rejects a point with a non-finite timestamp", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      fakeResponse({ body: [{ ...REAL_POINT, timestamp: null }] }),
    ) as unknown as typeof fetch;

    const { points } = await createDawarichClient(CONN).getPoints({
      startAt: new Date(0),
      endAt: new Date(),
    });
    expect(points).toEqual([]);
  });

  it("throws protocol when the body is not a bare array", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse({ body: { points: [] } })) as unknown as typeof fetch;

    await expect(
      createDawarichClient(CONN).getPoints({ startAt: new Date(0), endAt: new Date() }),
    ).rejects.toMatchObject({ kind: "protocol" });
  });

  it("paginates: continues to page 2 when page 1 is exactly full, stops when a page is short", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ ...REAL_POINT, id: i }));
    const shortPage = [{ ...REAL_POINT, id: 9999 }];
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(fakeResponse({ body: fullPage }))
      .mockResolvedValueOnce(fakeResponse({ body: shortPage }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { points, truncated } = await createDawarichClient(CONN).getPoints({
      startAt: new Date(0),
      endAt: new Date(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(points).toHaveLength(1001);
    expect(truncated).toBe(false);
    const secondCallUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(secondCallUrl.searchParams.get("page")).toBe("2");
  });

  // MEDIUM-2 (final whole-phase review, 2026-08-29): a window that still had
  // more to give when the hard page cap (`MAX_PAGES=50`) was hit used to only
  // LOG a warning — the caller got back a plain array indistinguishable from
  // a complete pull. `truncated` must now reach every caller.
  it("reports truncated=true when the hard page cap is hit on a still-full page", async () => {
    const fullPage = (offset: number) =>
      Array.from({ length: 1000 }, (_, i) => ({ ...REAL_POINT, id: offset + i }));
    const fetchMock = jest.fn();
    for (let page = 1; page <= 50; page += 1) {
      fetchMock.mockResolvedValueOnce(fakeResponse({ body: fullPage(page * 1000) }));
    }
    global.fetch = fetchMock as unknown as typeof fetch;

    const { points, truncated } = await createDawarichClient(CONN).getPoints({
      startAt: new Date(0),
      endAt: new Date(),
    });

    // Exactly MAX_PAGES requests — a 51st would mean the hard stop failed.
    expect(fetchMock).toHaveBeenCalledTimes(50);
    expect(points).toHaveLength(50_000);
    expect(truncated).toBe(true);
  });

  it("reports truncated=false when the last page is short, even at exactly MAX_PAGES", async () => {
    const fullPage = (offset: number) =>
      Array.from({ length: 1000 }, (_, i) => ({ ...REAL_POINT, id: offset + i }));
    const fetchMock = jest.fn();
    for (let page = 1; page <= 49; page += 1) {
      fetchMock.mockResolvedValueOnce(fakeResponse({ body: fullPage(page * 1000) }));
    }
    fetchMock.mockResolvedValueOnce(fakeResponse({ body: [{ ...REAL_POINT, id: 99999 }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { truncated } = await createDawarichClient(CONN).getPoints({
      startAt: new Date(0),
      endAt: new Date(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(50);
    expect(truncated).toBe(false);
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [404, "notFound"],
    [500, "unreachable"],
    [418, "protocol"],
  ])("maps HTTP %i to kind=%s", async (status, kind) => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse({ ok: false, status })) as unknown as typeof fetch;

    await expect(
      createDawarichClient(CONN).getPoints({ startAt: new Date(0), endAt: new Date() }),
    ).rejects.toMatchObject({ kind, status });
  });

  it("maps a network failure to kind=unreachable", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;

    await expect(
      createDawarichClient(CONN).getPoints({ startAt: new Date(0), endAt: new Date() }),
    ).rejects.toBeInstanceOf(DawarichError);
  });
});
