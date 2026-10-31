import { resetInstanceTuning, setInstanceTuning } from "../../services/instanceTuning";
import express from "express";
import request from "supertest";
import logger from "../../utils/logger";
import geoServer from "../geoServer";

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const app = express();
app.use("/geo", geoServer);
const STYLE = "/geo/assets/styles/dark/style.json";

describe("own geo server asset proxy", () => {
  beforeEach(() => {
    setInstanceTuning({ ownGeoUrl: "https://geo.example" });
    jest.mocked(logger.warn).mockClear();
  });
  afterEach(() => {
    resetInstanceTuning();
    jest.restoreAllMocks();
  });

  // Every upstream failure used to become the same silent 503: an operator
  // could not tell a dead map server from a slow one or a broken style.
  test("tells a timed-out upstream apart from an unreachable one", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    const { ownGeoRequest } = await import("../../services/geo/ownServerTransport");
    await expect(ownGeoRequest("/styles/dark/style.json", { timeoutMs: 20 })).rejects.toThrow(
      "timeout"
    );
  });

  test("logs an unreachable upstream with its cause", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await request(app).get(STYLE);
    expect(res.status).toBe(503);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "unavailable", detail: "ECONNREFUSED", asset: "styles" }),
      expect.any(String)
    );
  });

  test("answers an unparsable style as an invalid response and logs it", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("{not json", { headers: { "content-type": "application/json" } })
      );
    const res = await request(app).get(STYLE);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "geo_invalid_response" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "parse" }),
      expect.any(String)
    );
  });

  test("tells the client when to retry while the upstream cap is reached", async () => {
    const hang = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            )
          )
      );
    const { ownGeoRequest } = await import("../../services/geo/ownServerTransport");
    const held = Array.from({ length: 24 }, () =>
      ownGeoRequest("/styles/dark/style.json", { timeoutMs: 2_000 }).catch(() => undefined)
    );
    const res = await request(app).get(STYLE);
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "busy" }),
      expect.any(String)
    );
    await Promise.all(held);
    hang.mockRestore();
  });

  test("does not log tile coordinates", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await request(app).get("/geo/assets/tiles/basemap/14/8802/5374");
    const logged = JSON.stringify(jest.mocked(logger.warn).mock.calls);
    expect(logged).not.toContain("8802");
    expect(logged).toContain('"asset":"tiles"');
  });
});
