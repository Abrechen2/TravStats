import {
  createRegionalElevation,
  createRegionalRouting,
  createRegionalSearch,
  type Capability,
  type Point,
  type Release,
  type RoutingRelease,
} from "../regionalProvider";

/**
 * The provider contract was pinned in a `node:test` file (`.test.mjs`) that
 * Jest never collected (testMatch is `*.test.ts`) and no script ran, so every
 * guarantee below — no credentials, no external fallback, bounds and size
 * enforced before trusting a response — was asserted by nothing.
 */
const release: RoutingRelease = {
  origin: "https://geo.example.invalid",
  datasetId: "berlin-test-1",
  datasetSha256: "a".repeat(64),
  dataAsOf: "2026-10-01T00:00:00Z",
  bounds: [13, 52, 14, 53],
  timeoutMs: 100,
  maxResponseBytes: 2048,
  builtMode: "road",
  profile: "car",
  profileSha256: "b".repeat(64),
};
const config: Capability<RoutingRelease> = { policy: "own-only", release };
const elevationConfig: Capability<Release & { dataset: string }> = {
  policy: "own-only",
  release: { ...release, dataset: "srtm-local" },
};
const from: Point = [13.4, 52.5];
const to: Point = [13.5, 52.6];
const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const route = {
  code: "Ok",
  routes: [
    { geometry: { type: "LineString", coordinates: [from, to] }, distance: 1000, duration: 120 },
  ],
};
type FetchArgs = Parameters<typeof fetch>;
const urlOf = (input: FetchArgs[0]): URL => new URL(String(input));

describe("regional geo provider", () => {
  it("enforces the built graph mode and the regional bounds before any request", async () => {
    let requests = 0;
    const client = createRegionalRouting(config, async () => {
      requests++;
      return json(route);
    });
    await expect(client.route("foot", from, to)).rejects.toThrow(/mode_not_built/);
    await expect(client.route("road", [0, 0], to)).rejects.toThrow(/outside_coverage/);
    await expect(client.route("road", [NaN, 52], to)).rejects.toThrow(/outside_coverage/);
    expect(requests).toBe(0);
  });

  it("routes only on the configured graph, omits credentials and converts units", async () => {
    const client = createRegionalRouting(config, async (input, options) => {
      const url = urlOf(input);
      expect(url.origin).toBe(release.origin);
      expect(url.pathname).toMatch(/route\/v1\/car/);
      expect(options?.redirect).toBe("error");
      expect(options?.credentials).toBe("omit");
      expect(options?.headers).toEqual({ Accept: "application/json" });
      return json(route);
    });
    const result = await client.route("road", from, to);
    expect(result.distanceKm).toBe(1);
    expect(result.drivingMinutes).toBe(2);
    expect(result.datasetId).toBe(release.datasetId);
  });

  it("never falls back externally on an upstream failure, nor discloses its error URL", async () => {
    let calls = 0;
    const client = createRegionalRouting(config, async () => {
      calls++;
      throw Error("https://secret.example/token?coordinates=private");
    });
    await expect(client.route("road", from, to)).rejects.toThrow(/^upstream_unavailable$/);
    expect(calls).toBe(1);
  });

  it("fails closed on a disabled capability, credentials, query tokens and oversized regions", () => {
    expect(() => createRegionalRouting({ policy: "disabled" })).toThrow(/disabled/);
    for (const origin of [
      "http://geo.example",
      "https://user:pass@geo.example",
      "https://geo.example/?token=x",
    ])
      expect(() => createRegionalRouting({ ...config, release: { ...release, origin } })).toThrow();
    expect(() =>
      createRegionalRouting({ ...config, release: { ...release, bounds: [-180, -80, 180, 80] } })
    ).toThrow();
  });

  it.each([
    [
      "an HTTP 200 HTML page",
      () => new Response("<html>ok</html>", { headers: { "Content-Type": "text/html" } }),
    ],
    ["NoRoute", () => json({ code: "NoRoute", routes: [] })],
    [
      "a geometry leaving the region",
      () =>
        json({
          code: "Ok",
          routes: [
            { ...route.routes[0], geometry: { type: "LineString", coordinates: [from, [0, 0]] } },
          ],
        }),
    ],
  ])("rejects %s", async (_label, response) => {
    await expect(
      createRegionalRouting(config, async () => response()).route("road", from, to)
    ).rejects.toThrow();
  });

  it("rejects chunked oversized JSON even without a content-length", async () => {
    const client = createRegionalRouting(
      config,
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(3000));
              c.close();
            },
          }),
          { headers: { "content-type": "application/json" } }
        )
    );
    await expect(client.route("road", from, to)).rejects.toThrow(/response_too_large/);
  });

  it("aborts a stalled upstream at the deadline without retrying", async () => {
    const client = createRegionalRouting(
      config,
      async (_input, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(Error("aborted")), {
            once: true,
          });
        })
    );
    await expect(client.route("road", from, to)).rejects.toThrow(/timeout/);
  });

  it("drops search results outside the region and sends the bbox", async () => {
    const client = createRegionalSearch(config, async (input) => {
      expect(urlOf(input).searchParams.get("bbox")).toBe("13,52,14,53");
      return json({
        type: "FeatureCollection",
        features: [from, [0, 0]].map((coordinates) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates },
        })),
      });
    });
    expect((await client.search("Berlin")).features).toHaveLength(1);
  });

  it("keeps DEM order, data identity and NoData; the cache is dataset-versioned", async () => {
    const client = createRegionalElevation(elevationConfig, async (input) => {
      expect(urlOf(input).searchParams.get("locations")).toBe("52.5,13.4|52.6,13.5");
      return json({
        status: "OK",
        results: [
          { location: { lng: 13.4, lat: 52.5 }, dataset: "srtm-local", elevation: 34 },
          { location: { lng: 13.5, lat: 52.6 }, dataset: "srtm-local", elevation: null },
        ],
      });
    });
    expect((await client.elevation([from, to])).elevations).toEqual([34, null]);
    expect(client.cacheNamespace).toContain(release.datasetSha256);
  });

  it("does not accept a wrong DEM or swapped locations as valid elevations", async () => {
    const client = createRegionalElevation(elevationConfig, async () =>
      json({
        status: "OK",
        results: [{ location: { lng: 52.5, lat: 13.4 }, dataset: "other", elevation: 34 }],
      })
    );
    await expect(client.elevation([from])).rejects.toThrow(/invalid_elevation/);
  });
});
