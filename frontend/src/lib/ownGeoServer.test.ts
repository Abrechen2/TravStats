// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { ownBasemapCatalogue, ownMapStyle, usesOwnGeoServer } from "./ownGeoServer";

afterEach(() => {
  delete window.__TRAVSTATS_GEO__;
});
describe("server runtime map opt-in", () => {
  it("retains legacy style and catalogue when explicitly disabled", () => {
    window.__TRAVSTATS_GEO__ = { mode: "legacy" };
    expect(ownMapStyle("dark", "https://legacy.example/style")).toBe(
      "https://legacy.example/style"
    );
    expect(ownBasemapCatalogue([{ id: "satellite", style: "legacy" }])).toHaveLength(1);
  });
  // A failed /geo-server/runtime (a 502 while the server restarts) left the
  // bootstrap "pending", which pointed every map at own-server assets that 404
  // without TRAVSTATS_GEO_URL: all maps blank until a reload.
  it("keeps the legacy styles while the server mode is unconfirmed", () => {
    window.__TRAVSTATS_GEO__ = { mode: "pending" };
    expect(usesOwnGeoServer()).toBe(false);
    expect(ownMapStyle("dark", "https://legacy.example/style")).toBe(
      "https://legacy.example/style"
    );
  });
  it("never sends a map to a third party in confirmed own mode", () => {
    window.__TRAVSTATS_GEO__ = { mode: "own" };
    expect(usesOwnGeoServer()).toBe(true);
    expect(ownMapStyle("dark", "https://legacy.example/style")).toBe(
      "/api/v1/geo-server/assets/styles/dark/style.json"
    );
    expect(ownMapStyle("satellite", "https://legacy.example/style")).toBe(
      "/api/v1/geo-server/assets/styles/dark/style.json"
    );
    expect(
      ownBasemapCatalogue([
        { id: "dark", style: "external" },
        { id: "satellite", style: "external" },
      ])
    ).toEqual([{ id: "dark", style: "/api/v1/geo-server/assets/styles/dark/style.json" }]);
  });
});
