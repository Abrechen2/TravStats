jest.mock("../consent", () => ({
  getConsent: jest.fn(),
  getStatsBaseUrl: jest.fn(),
  getInstallId: jest.fn(),
}));
jest.mock("../payload", () => ({ buildUsagePayload: jest.fn() }));

import { sendPing, sendErasure, usageStatsTick } from "../transport";
import { getConsent, getStatsBaseUrl } from "../consent";
import { buildUsagePayload } from "../payload";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const PAYLOAD = { install_id: "abc", version: "2.4.0" } as never;

beforeEach(() => {
  jest.clearAllMocks();
  (buildUsagePayload as jest.Mock).mockResolvedValue(PAYLOAD);
  (getStatsBaseUrl as jest.Mock).mockReturnValue("https://stats.test");
  (getConsent as jest.Mock).mockResolvedValue("granted");
});

describe("sendPing", () => {
  it("POSTs to <base>/v1/ping and reports success", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    await expect(sendPing(PAYLOAD, "https://stats.test")).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://stats.test/v1/ping",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns false on a non-2xx response, and does not throw", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(sendPing(PAYLOAD, "https://stats.test")).resolves.toBe(false);
  });

  it("returns false when the network rejects, and does not throw", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(sendPing(PAYLOAD, "https://stats.test")).resolves.toBe(false);
  });
});

describe("sendErasure", () => {
  it("DELETEs <base>/v1/install/<id>", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    await expect(sendErasure("abc123", "https://stats.test")).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://stats.test/v1/install/abc123",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("never throws on failure", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));
    await expect(sendErasure("abc123", "https://stats.test")).resolves.toBe(false);
  });
});

describe("usageStatsTick", () => {
  it("sends when consent is granted", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    await usageStatsTick();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each(["unset", "denied"])("sends nothing when consent is %s", async (state) => {
    (getConsent as jest.Mock).mockResolvedValue(state);
    await usageStatsTick();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(buildUsagePayload).not.toHaveBeenCalled();
  });

  it("sends nothing when the endpoint is empty, even when granted", async () => {
    (getStatsBaseUrl as jest.Mock).mockReturnValue("");
    await usageStatsTick();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("never throws when payload construction blows up", async () => {
    (buildUsagePayload as jest.Mock).mockRejectedValue(new Error("db down"));
    await expect(usageStatsTick()).resolves.toBeUndefined();
  });
});
