import { describe, it, expect, vi, beforeEach } from "vitest";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { friendsApi, friendsErrorKey, FRIENDS_CODES } from "../friends";
import { api } from "../client";
import de from "../../../i18n/resources/de/comparison.json";
import en from "../../../i18n/resources/en/comparison.json";
import { NO_SWITCHES } from "../../../types/sharingRemote";

vi.mock("../client", () => ({ api: { get: vi.fn(), request: vi.fn() } }));

const failure = (status: number, data: unknown): AxiosError =>
  new AxiosError("failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    data,
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  });

beforeEach(() => vi.clearAllMocks());

describe("friendsApi", () => {
  it("unwraps the envelope and encodes the key", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { toThem: [], fromThem: [] } },
    });
    await friendsApi.trips("remote:a/b");
    expect(api.get).toHaveBeenCalledWith("/friends/remote%3Aa%2Fb/trips");
  });

  it("sends a request with the switches and never a scope; setting the scope is its own call", async () => {
    vi.mocked(api.request).mockResolvedValue({ data: { success: true, data: {} } });
    await friendsApi.request("lena", null, NO_SWITCHES);
    expect(vi.mocked(api.request).mock.calls[0][0]).toEqual({
      method: "post",
      url: "/friends",
      data: { username: "lena", origin: null, switches: NO_SWITCHES },
    });
    await friendsApi.setSwitches("local:1", NO_SWITCHES);
    expect(vi.mocked(api.request).mock.calls[1][0]).toMatchObject({
      method: "put",
      url: "/friends/local%3A1/switches",
      data: { switches: NO_SWITCHES },
    });
    await friendsApi.setScope("local:1", { groups: ["trips"], domains: ["flight"], year: null });
    expect(vi.mocked(api.request).mock.calls[2][0]).toMatchObject({
      url: "/friends/local%3A1/scope",
    });
  });
});

describe("friendsErrorKey", () => {
  it("maps a /friends code, falls back to the comparison mapper", () => {
    expect(friendsErrorKey(failure(409, { code: "FRIENDS_CONNECTION_STATE" }))).toBe(
      "error.FRIENDS_CONNECTION_STATE"
    );
    expect(friendsErrorKey(failure(409, { code: "COMPARISON_SELF" }))).toBe(
      "error.COMPARISON_SELF"
    );
    expect(friendsErrorKey(failure(429, "slow down"))).toBe("error.rateLimited");
    expect(friendsErrorKey(new Error("plain"))).toBe("error.unknown");
  });

  it("every /friends code has DE and EN copy", () => {
    for (const code of FRIENDS_CODES) {
      expect((de.error as Record<string, string>)[code], code).toBeTruthy();
      expect((en.error as Record<string, string>)[code], code).toBeTruthy();
    }
  });
});
