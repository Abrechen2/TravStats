import { describe, it, expect, vi, beforeEach } from "vitest";
import { evidenceApi } from "../evidence";
import { api } from "../client";

vi.mock("../client", () => ({
  api: { get: vi.fn() },
}));

describe("evidenceApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GETs /evidence/:kind/:key with the key percent-encoded", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { entries: [] } });
    await evidenceApi.get("ranking", "airline:LH");
    // Express hands the path param back decoded; the colon must survive the
    // trip through the URL first (design, "The contract").
    expect(api.get).toHaveBeenCalledWith("/evidence/ranking/airline%3ALH", {
      params: { offset: undefined, limit: undefined, domains: undefined },
    });
  });

  it("joins domains with a comma and forwards paging", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { entries: [] } });
    await evidenceApi.get("metric", "flightCount", {
      period: "year",
      year: 2026,
      domains: ["flight", "cruise"],
      offset: 100,
      limit: 100,
    });
    expect(api.get).toHaveBeenCalledWith("/evidence/metric/flightCount", {
      params: { period: "year", year: 2026, offset: 100, limit: 100, domains: "flight,cruise" },
    });
  });

  it("omits domains entirely rather than sending an empty string", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { entries: [] } });
    await evidenceApi.get("metric", "flightCount", { domains: [] });
    expect(api.get).toHaveBeenCalledWith(
      "/evidence/metric/flightCount",
      expect.objectContaining({ params: expect.objectContaining({ domains: undefined }) })
    );
  });

  it("returns the response body as-is", async () => {
    const body = { measure: { value: 3 }, entries: [] };
    vi.mocked(api.get).mockResolvedValue({ data: body });
    const result = await evidenceApi.get("metric", "flightCount");
    expect(result).toBe(body);
  });
});
