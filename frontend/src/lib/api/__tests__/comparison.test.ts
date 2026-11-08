import { describe, it, expect, vi, beforeEach } from "vitest";
import { comparisonApi } from "../comparison";
import { api } from "../client";

vi.mock("../client", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const wrap = (data: unknown) => ({ data: { success: true, data } });

const switches = {
  plans: true,
  stats: "full" as const,
  achievements: true,
  leaderboard: true,
  tripOffers: true,
};

describe("comparisonApi — the Freunde page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("compare asks for exactly the picked keys and the period", async () => {
    vi.mocked(api.get).mockResolvedValue(wrap({ year: 2024, self: {}, friends: [] }));
    await comparisonApi.compare(["local:a", "remote:b"], 2024);
    expect(api.get).toHaveBeenCalledWith(
      "/comparison/compare",
      expect.objectContaining({ params: { friends: "local:a,remote:b", year: "2024" } })
    );
    await comparisonApi.compare([], "all");
    expect(vi.mocked(api.get).mock.calls[1][1]).toMatchObject({
      params: { friends: "", year: "all" },
    });
  });

  it("creates and redeems an invitation link and unwraps the envelope", async () => {
    vi.mocked(api.post).mockResolvedValueOnce(wrap({ url: "https://a.example/x", expiresAt: "t" }));
    await expect(comparisonApi.createInviteLink()).resolves.toEqual({
      url: "https://a.example/x",
      expiresAt: "t",
    });
    expect(api.post).toHaveBeenCalledWith("/comparison/invite-links", {});
    vi.mocked(api.post).mockResolvedValueOnce(wrap({ status: "awaitingAdmin" }));
    await expect(comparisonApi.redeemInviteLink("PAYLOAD", switches)).resolves.toEqual({
      status: "awaitingAdmin",
    });
    expect(api.post).toHaveBeenLastCalledWith("/comparison/invite-links/redeem", {
      payload: "PAYLOAD",
      switches,
    });
    // A link made with the inviter's switches carries them (spec 2026-11-08 §11.7).
    vi.mocked(api.post).mockResolvedValueOnce(wrap({ url: "u", expiresAt: "t" }));
    await comparisonApi.createInviteLink(switches);
    expect(api.post).toHaveBeenLastCalledWith("/comparison/invite-links", { switches });
  });

  it("lists the reader's own admissions as an array", async () => {
    vi.mocked(api.get).mockResolvedValue(wrap({ admissions: [{ id: "1" }] }));
    await expect(comparisonApi.listAdmissions()).resolves.toEqual([{ id: "1" }]);
    expect(api.get).toHaveBeenCalledWith("/comparison/admissions", expect.anything());
  });
});
