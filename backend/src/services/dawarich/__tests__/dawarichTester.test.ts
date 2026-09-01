import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const checkHealth = jest.fn<() => Promise<{ reachable: true; version: string | null }>>();
const getPoints = jest.fn();

jest.mock("../dawarichClient", () => ({
  createDawarichClient: () => ({ checkHealth, getPoints }),
}));

import { testDawarichConnection } from "../dawarichTester";
import { DawarichError } from "../errors";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("testDawarichConnection", () => {
  it("reports the server version on success", async () => {
    checkHealth.mockResolvedValue({ reachable: true, version: "1.9.2" });
    getPoints.mockResolvedValue([]);

    await expect(testDawarichConnection("https://dawarich.lan", "key")).resolves.toEqual({
      success: true,
      message: "Connected to Dawarich",
      details: { version: "1.9.2" },
    });
  });

  it("omits details when the version header was absent", async () => {
    checkHealth.mockResolvedValue({ reachable: true, version: null });
    getPoints.mockResolvedValue([]);

    await expect(testDawarichConnection("https://dawarich.lan", "key")).resolves.toEqual({
      success: true,
      message: "Connected to Dawarich",
      details: undefined,
    });
  });

  it("distinguishes a bad key from an unreachable server, carrying the kind", async () => {
    checkHealth.mockResolvedValue({ reachable: true, version: "1.9.2" });
    getPoints.mockRejectedValue(new DawarichError("auth", "Dawarich rejected the API key", 401));
    await expect(testDawarichConnection("https://dawarich.lan", "bad")).resolves.toMatchObject({
      success: false,
      kind: "auth",
      message: "Dawarich rejected the API key",
    });

    checkHealth.mockRejectedValue(new DawarichError("unreachable", "Dawarich is unreachable"));
    await expect(testDawarichConnection("https://dawarich.lan", "key")).resolves.toMatchObject({
      success: false,
      kind: "unreachable",
      message: "Dawarich is unreachable",
    });
  });

  it("reports a non-http base URL as an invalidUrl kind without calling Dawarich", async () => {
    await expect(testDawarichConnection("file:///etc/passwd", "key")).resolves.toMatchObject({
      success: false,
      kind: "invalidUrl",
      message: "Dawarich URL must use http:// or https://",
    });
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it("reports a malformed base URL as an invalidUrl kind without calling Dawarich", async () => {
    await expect(testDawarichConnection("not-a-url", "key")).resolves.toMatchObject({
      success: false,
      kind: "invalidUrl",
      message: "Dawarich URL is not a valid URL",
    });
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it("reports a protocol mismatch when the server answers with garbage", async () => {
    checkHealth.mockRejectedValue(
      new DawarichError("protocol", "Dawarich health check returned an unexpected payload"),
    );
    await expect(testDawarichConnection("https://dawarich.lan", "key")).resolves.toEqual({
      success: false,
      kind: "protocol",
      message: "Dawarich health check returned an unexpected payload",
    });
  });

  it("reports notFound when the server answers 404", async () => {
    checkHealth.mockResolvedValue({ reachable: true, version: "1.9.2" });
    getPoints.mockRejectedValue(
      new DawarichError("notFound", "Dawarich resource not found (points page=1)", 404),
    );
    await expect(testDawarichConnection("https://dawarich.lan", "key")).resolves.toMatchObject({
      success: false,
      kind: "notFound",
    });
  });

  it("falls back to kind=unreachable for a non-DawarichError throw", async () => {
    checkHealth.mockRejectedValue(new Error("boom"));
    await expect(testDawarichConnection("https://dawarich.lan", "key")).resolves.toEqual({
      success: false,
      kind: "unreachable",
      message: "Could not reach Dawarich",
    });
  });
});
