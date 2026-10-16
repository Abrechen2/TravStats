import { describe, it, expect, vi, beforeEach } from "vitest";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { comparisonApi, comparisonFailureCode, KNOWN_COMPARISON_CODES } from "../../api/comparison";
import { api } from "../../api/client";
import de from "../../../i18n/resources/de/comparison.json";
import en from "../../../i18n/resources/en/comparison.json";

vi.mock("../../api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

function failure(status: number, data: unknown): AxiosError {
  return new AxiosError("failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    data,
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("comparisonApi.leaderboard", () => {
  it("waits longer than the server's 12 s pull so a slow peer is a row, not a failed load", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { year: null, rows: [] } },
    });
    await comparisonApi.leaderboard(null);
    const config = vi.mocked(api.get).mock.calls[0][1];
    expect(config?.timeout).toBeGreaterThan(12000);
    expect(config?.params).toEqual({ year: "all" });
  });
  it("sends the year and the board", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { year: 2025, rows: [] } },
    });
    await comparisonApi.leaderboard(2025, "b1");
    expect(vi.mocked(api.get).mock.calls[0][1]?.params).toEqual({ year: "2025", board: "b1" });
  });
});

describe("comparisonFailureCode", () => {
  it("maps a plain-text throttle 429 to its own code", () => {
    expect(comparisonFailureCode(failure(429, "Too many comparison requests"))).toBe("rateLimited");
  });
  it("reads the code from the body", () => {
    expect(comparisonFailureCode(failure(409, { code: "COMPARISON_NOT_PENDING" }))).toBe(
      "COMPARISON_NOT_PENDING"
    );
  });
  it("falls back to unknown", () => {
    expect(comparisonFailureCode(failure(500, { code: "SOMETHING" }))).toBe("unknown");
    expect(comparisonFailureCode(new Error("plain"))).toBe("unknown");
  });
  it("has a German and an English sentence for every code", () => {
    for (const code of [...KNOWN_COMPARISON_CODES, "rateLimited", "unknown"]) {
      expect((de.error as Record<string, string>)[code], `de ${code}`).toBeTruthy();
      expect((en.error as Record<string, string>)[code], `en ${code}`).toBeTruthy();
    }
  });
  it("covers the codes the API can return", () => {
    for (const code of [
      "COMPARISON_BOARD_LIMIT",
      "COMPARISON_REMOTE_LIMIT",
      "COMPARISON_INVITE_LIMIT",
      "COMPARISON_DUPLICATE",
      "COMPARISON_NOT_PENDING",
    ]) {
      expect(KNOWN_COMPARISON_CODES).toContain(code);
    }
  });
});
