import { resetInstanceTuning, setInstanceTuning } from "../../instanceTuning";
import { parseOwnGeoUrl } from "../ownServerConfig";
import { allowedMapAsset, rewriteMapDocument } from "../ownMapAssets";
import { ownGeoRequest } from "../ownServerTransport";

describe("operator-owned map server", () => {
  afterEach(() => {
    resetInstanceTuning();
    jest.restoreAllMocks();
  });
  test("absent or empty ENV preserves legacy mode", () => {
    expect(parseOwnGeoUrl(undefined)).toBeNull();
    expect(parseOwnGeoUrl("")).toBeNull();
  });
  test.each([
    "http://geo.example",
    "https://u:p@geo.example",
    "https://geo.example/path",
    "https://geo.example?x=1",
    " https://geo.example",
    "https://geo.example/#x",
  ])("rejects unsafe ENV %s", (value) => {
    expect(() => parseOwnGeoUrl(value)).toThrow("geo server address");
  });
  test("canonicalizes a private HTTPS origin", () => {
    expect(parseOwnGeoUrl("https://geo.example:8443/")).toBe("https://geo.example:8443");
  });
  test.each([
    "/../health",
    "/fonts/../../etc/passwd",
    "/tiles/basemap/17/0/0",
    "/tiles/basemap/2/4/0",
    "/styles/evil/style.json",
    "/fonts/Noto Sans Regular/1-256.pbf",
    "/tiles/basemap?url=https://other.invalid",
    "/%2e%2e/catalog",
  ])("refuses non-resource path %s", (path) => {
    expect(allowedMapAsset(path)).toBe(false);
  });
  test("permits only bounded tiles and approved fonts", () => {
    expect(allowedMapAsset("/tiles/basemap/14/8802/5374")).toBe(true);
    expect(allowedMapAsset("/fonts/Noto Sans Regular/0-255.pbf")).toBe(true);
  });
  test("rewrites style resources to same origin while retaining attribution", () => {
    const doc = rewriteMapDocument(
      "/styles/dark/style.json",
      {
        version: 8,
        glyphs: "https://upstream.example/fonts/{fontstack}/{range}.pbf",
        sprite: "https://upstream.example/sprites/v4/dark",
        sources: {
          base: {
            type: "vector",
            url: "https://upstream.example/tiles/basemap",
            attribution: "© OSM",
          },
        },
        layers: [],
      },
      "https://app.example"
    );
    expect(JSON.stringify(doc)).not.toContain("upstream.example");
    expect(JSON.stringify(doc)).toContain("© OSM");
    expect(JSON.stringify(doc)).toContain(
      "/api/v1/geo-server/assets/fonts/{fontstack}/{range}.pbf"
    );
  });
  test("rejects foreign data types and style imports", () => {
    expect(() =>
      rewriteMapDocument(
        "/styles/dark/style.json",
        { version: 8, sources: { x: { type: "geojson", data: "https://x.invalid" } }, layers: [] },
        "https://app.example"
      )
    ).toThrow();
    expect(() =>
      rewriteMapDocument(
        "/styles/dark/style.json",
        { version: 8, sources: {}, layers: [], imports: [] },
        "https://app.example"
      )
    ).toThrow();
  });
  test("does not contact a provider without opt-in", async () => {
    resetInstanceTuning();
    const fetcher = jest.spyOn(globalThis, "fetch");
    await expect(ownGeoRequest("/healthz")).rejects.toThrow("disabled");
    expect(fetcher).not.toHaveBeenCalled();
  });
  test("sends no credentials and forbids redirects", async () => {
    setInstanceTuning({ ownGeoUrl: "https://geo.example" });
    const fetcher = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("ok", { headers: { "content-type": "application/octet-stream" } })
      );
    expect((await ownGeoRequest("/healthz")).body.toString()).toBe("ok");
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://geo.example/healthz"),
      expect.objectContaining({ redirect: "error", headers: { Accept: "*/*" } })
    );
  });
  test("caps streamed responses even without a content length", async () => {
    setInstanceTuning({ ownGeoUrl: "https://geo.example" });
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("123456"));
    await expect(ownGeoRequest("/healthz", { maxBytes: 4 })).rejects.toThrow("invalid_response");
  });
  test("upstream failure never triggers another provider", async () => {
    setInstanceTuning({ ownGeoUrl: "https://geo.example" });
    const fetcher = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(ownGeoRequest("/healthz")).rejects.toThrow("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
