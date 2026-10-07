import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock("../client", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

import { busApi } from "../bus";
import type { BusJourney, BusJourneyInput } from "../../../types/bus";

const ride = { id: "b-1", depStationName: "Tallinn", arrStationName: "Riga" } as BusJourney;
const SUMMARY = { journeys: 1, operators: 1, withoutOperator: 0, stations: 2 };

beforeEach(() => vi.clearAllMocks());

describe("busApi", () => {
  it("list() unwraps the envelope into journeys, total and the server's summary", async () => {
    get.mockResolvedValue({
      data: { success: true, data: [ride], meta: { total: 7, summary: SUMMARY } },
    });
    const page = await busApi.list({ year: 2026, limit: 20 });
    expect(get).toHaveBeenCalledWith("/bus", { params: { year: 2026, limit: 20 } });
    expect(page).toEqual({ journeys: [ride], total: 7, summary: SUMMARY });
  });

  it("create() posts the body to /bus and returns the stored ride", async () => {
    post.mockResolvedValue({ data: { success: true, data: ride } });
    const input = { operator: "FlixBus" } as BusJourneyInput;
    await expect(busApi.create(input)).resolves.toBe(ride);
    expect(post).toHaveBeenCalledWith("/bus", input);
  });

  it("update() patches /bus/<id> with only the fields given", async () => {
    patch.mockResolvedValue({ data: { success: true, data: ride } });
    await expect(busApi.update("b 1", { tripId: "t-1" })).resolves.toBe(ride);
    expect(patch).toHaveBeenCalledWith("/bus/b%201", { tripId: "t-1" });
  });

  it("remove() deletes /bus/<id>", async () => {
    del.mockResolvedValue({ data: {} });
    await busApi.remove("b-1");
    expect(del).toHaveBeenCalledWith("/bus/b-1");
  });
});
