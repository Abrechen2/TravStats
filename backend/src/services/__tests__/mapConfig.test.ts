import { getMapConfig } from "../mapConfig";
import express from "express";
import request from "supertest";
import router from "../../routes/mapConfig";
import { assetPathGuard } from "../../middleware/assetPathGuard";

describe("public map configuration", () => {
  it("defaults all vector styles to OpenFreeMap", () => {
    const config = getMapConfig({});
    expect(
      Object.values(config.styles).every((url) =>
        url.startsWith("https://tiles.openfreemap.org/styles/")
      )
    ).toBe(true);
  });
  it.each([
    "http://example.com/map",
    "https://user:password@example.com/map",
    "https://example.com/map?key=secret",
    "javascript:alert(1)",
    " https://example.com/map",
  ])("rejects unsafe configuration without leaking it: %s", (value) => {
    expect(() => getMapConfig({ MAP_STYLE_DARK_URL: value })).toThrow("MAP_STYLE_DARK_URL must be");
  });
  it("publishes an HTTPS override", () => {
    expect(getMapConfig({ MAP_STYLE_DARK_URL: "https://maps.example.com/dark" }).styles.dark).toBe(
      "https://maps.example.com/dark"
    );
  });
  it("serves JSON and executable configuration through the real asset guard", async () => {
    const app = express();
    app.use("/api", assetPathGuard);
    app.use("/api/v1/map-config", router);
    const response = await request(app).get("/api/v1/map-config").expect(200);
    const runtime = await request(app).get("/api/v1/map-config/runtime").expect(200);
    expect(response.body.version).toBe(1);
    expect(runtime.headers["content-type"]).toContain("javascript");
    expect(runtime.text).toContain(JSON.stringify(response.body));
    expect(runtime.headers["cache-control"]).toBe("no-store");
  });
});
