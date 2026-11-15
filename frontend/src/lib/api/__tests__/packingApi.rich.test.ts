import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../client";
import { packingApi } from "../companionData";

afterEach(() => vi.restoreAllMocks());

describe("packingApi reads and writes the single store in the rich shape (forgejo#398)", () => {
  it("asks for ?shape=rich on read", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { items: [], rev: 0 } });
    await packingApi.get("t1");
    expect(get).toHaveBeenCalledWith("/trips/t1/packing", { params: { shape: "rich" } });
  });
  it("asks for ?shape=rich on write, so scope and notes are not dropped by the legacy merge", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({ data: { items: [], rev: 1 } });
    await packingApi.put("t1", [], 0, "m1");
    expect(put).toHaveBeenCalledWith(
      "/trips/t1/packing",
      { items: [], baseRev: 0, mutationId: "m1" },
      { params: { shape: "rich" } }
    );
  });
});
