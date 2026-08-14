import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listLodgings,
  getLodging,
  createLodging,
  updateLodging,
  deleteLodging,
  createStay,
  updateStay,
  deleteStay,
  listChains,
  createChain,
  listMemberships,
  createMembership,
  updateMembership,
  deleteMembership,
  getLodgingStats,
  getFxPreview,
} from "../lodging";
import { api } from "../client";

vi.mock("../client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("lodging API client — lodgings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listLodgings() GETs /lodging with params and unwraps the envelope", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [{ id: "l1" }] } });
    const result = await listLodgings({ type: "hotel", sort: "nights" });
    expect(api.get).toHaveBeenCalledWith("/lodging", {
      params: { type: "hotel", sort: "nights", limit: 500, offset: 0 },
    });
    expect(result).toEqual([{ id: "l1" }]);
  });

  it("listLodgings() walks every page instead of stopping at the server's first one", async () => {
    // The defect this pins: one request, no limit, `meta` discarded. An account
    // past the page size then lost a contiguous alphabetical tail — silently,
    // because the server DOES report the truncation in `meta.total`.
    const page = (ids: string[], total: number, offset: number) => ({
      data: { success: true, data: ids.map((id) => ({ id })), meta: { total, limit: 500, offset } },
    });
    vi.mocked(api.get)
      .mockResolvedValueOnce(page(["a", "b"], 3, 0))
      .mockResolvedValueOnce(page(["c"], 3, 500));

    const result = await listLodgings();

    expect(result).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(api.get).toHaveBeenNthCalledWith(2, "/lodging", {
      params: { limit: 500, offset: 500 },
    });
  });

  it("listLodgings() stops on an empty page even if meta.total disagrees", async () => {
    // A `total` that outruns what the server actually returns must not spin the
    // walk to its cap on every page load.
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        data: { success: true, data: [{ id: "a" }], meta: { total: 9999, limit: 500, offset: 0 } },
      })
      .mockResolvedValueOnce({
        data: { success: true, data: [], meta: { total: 9999, limit: 500, offset: 500 } },
      });

    const result = await listLodgings();

    expect(result).toEqual([{ id: "a" }]);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("listLodgings() sends no filters of its own, only the page window", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [] } });
    await listLodgings();
    expect(api.get).toHaveBeenCalledWith("/lodging", { params: { limit: 500, offset: 0 } });
  });

  it("getLodging() GETs /lodging/:id and unwraps the envelope", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: { id: "l1" } } });
    const result = await getLodging("l1");
    expect(api.get).toHaveBeenCalledWith("/lodging/l1");
    expect(result).toEqual({ id: "l1" });
  });

  it("createLodging() POSTs /lodging", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: { id: "l1" } } });
    const result = await createLodging({ name: "Hilton Berlin" });
    expect(api.post).toHaveBeenCalledWith("/lodging", { name: "Hilton Berlin" });
    expect(result).toEqual({ id: "l1" });
  });

  it("updateLodging() PATCHes /lodging/:id", async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { success: true, data: { id: "l1" } } });
    await updateLodging("l1", { stars: 5 });
    expect(api.patch).toHaveBeenCalledWith("/lodging/l1", { stars: 5 });
  });

  it("deleteLodging() DELETEs /lodging/:id", async () => {
    vi.mocked(api.delete).mockResolvedValue({});
    await deleteLodging("l1");
    expect(api.delete).toHaveBeenCalledWith("/lodging/l1");
  });
});

describe("lodging API client — stays", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createStay() POSTs /lodging/:id/stays", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: { id: "s1" } } });
    const result = await createStay("l1", { checkIn: "2026-01-01T00:00:00.000Z" });
    expect(api.post).toHaveBeenCalledWith("/lodging/l1/stays", {
      checkIn: "2026-01-01T00:00:00.000Z",
    });
    expect(result).toEqual({ id: "s1" });
  });

  it("updateStay() PATCHes /lodging/:id/stays/:stayId", async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { success: true, data: { id: "s1" } } });
    await updateStay("l1", "s1", { notes: "great" });
    expect(api.patch).toHaveBeenCalledWith("/lodging/l1/stays/s1", { notes: "great" });
  });

  it("deleteStay() DELETEs /lodging/:id/stays/:stayId", async () => {
    vi.mocked(api.delete).mockResolvedValue({});
    await deleteStay("l1", "s1");
    expect(api.delete).toHaveBeenCalledWith("/lodging/l1/stays/s1");
  });
});

describe("lodging API client — chains", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listChains() GETs /lodging-chains with a search param", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [{ id: 1 }] } });
    const result = await listChains("hilton");
    expect(api.get).toHaveBeenCalledWith("/lodging-chains", { params: { search: "hilton" } });
    expect(result).toEqual([{ id: 1 }]);
  });

  it("listChains() omits the search param when not given", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [] } });
    await listChains();
    expect(api.get).toHaveBeenCalledWith("/lodging-chains", { params: {} });
  });

  it("createChain() POSTs /lodging-chains", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: { id: 1 } } });
    const result = await createChain({ name: "Novotel" });
    expect(api.post).toHaveBeenCalledWith("/lodging-chains", { name: "Novotel" });
    expect(result).toEqual({ id: 1 });
  });
});

describe("lodging API client — memberships", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listMemberships() GETs /lodging-memberships", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [{ id: "m1" }] } });
    const result = await listMemberships();
    expect(api.get).toHaveBeenCalledWith("/lodging-memberships");
    expect(result).toEqual([{ id: "m1" }]);
  });

  it("createMembership() POSTs /lodging-memberships", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: { id: "m1" } } });
    const result = await createMembership({ programName: "Marriott Bonvoy" });
    expect(api.post).toHaveBeenCalledWith("/lodging-memberships", { programName: "Marriott Bonvoy" });
    expect(result).toEqual({ id: "m1" });
  });

  it("updateMembership() PATCHes /lodging-memberships/:id", async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { success: true, data: { id: "m1" } } });
    await updateMembership("m1", { tier: "Gold" });
    expect(api.patch).toHaveBeenCalledWith("/lodging-memberships/m1", { tier: "Gold" });
  });

  it("deleteMembership() DELETEs /lodging-memberships/:id", async () => {
    vi.mocked(api.delete).mockResolvedValue({});
    await deleteMembership("m1");
    expect(api.delete).toHaveBeenCalledWith("/lodging-memberships/m1");
  });
});

describe("lodging API client — fx preview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getFxPreview() GETs /lodging/fx-preview with amount/from/date and unwraps the envelope", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { baseAmount: 391.23, rate: 0.9315, rateDate: "2026-07-11", baseCurrency: "EUR" } },
    });
    const result = await getFxPreview(420, "CHF", "2026-07-11");
    expect(api.get).toHaveBeenCalledWith("/lodging/fx-preview", {
      params: { amount: 420, from: "CHF", date: "2026-07-11" },
    });
    expect(result).toEqual({ baseAmount: 391.23, rate: 0.9315, rateDate: "2026-07-11", baseCurrency: "EUR" });
  });

  it("getFxPreview() passes through a null preview (ECB lookup failed)", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: null } });
    const result = await getFxPreview(420, "CHF", "2026-07-11");
    expect(result).toBeNull();
  });
});

describe("lodging API client — stats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getLodgingStats() GETs /stats/lodging and unwraps the envelope", async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { success: true, data: { lodgingsCount: 3, countries: ["DE", "FR"] } },
    });
    const result = await getLodgingStats();
    expect(api.get).toHaveBeenCalledWith("/stats/lodging");
    expect(result).toEqual({ lodgingsCount: 3, countries: ["DE", "FR"] });
  });
});
