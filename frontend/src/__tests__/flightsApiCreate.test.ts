import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../lib/api/client";
import { flightsApi } from "../lib/api/flights";
import type { FlightInput } from "../types";

// POST /flights responds with { flight, mergedFields?, newAchievements? }, not a
// bare Flight. flightsApi.create must flatten to the Flight so callers get a
// real `id` (regression: the cruise import's trip-assign sent [null, null]).
vi.mock("../lib/api/client", () => ({
  api: { post: vi.fn() },
}));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const minimalInput = { departure: {}, arrival: {} } as unknown as FlightInput;

describe("flightsApi.create", () => {
  beforeEach(() => postMock.mockReset());

  it("returns the flight with a real id (not the envelope)", async () => {
    postMock.mockResolvedValue({
      data: { flight: { id: "flight-123", airline: "LH" }, newAchievements: [] },
    });
    const created = await flightsApi.create(minimalInput, { force: true });
    expect(created.id).toBe("flight-123");
  });

  it("preserves mergedFields from the merge response", async () => {
    postMock.mockResolvedValue({
      data: { flight: { id: "flight-9" }, mergedFields: ["aircraft", "seatNumber"] },
    });
    const created = (await flightsApi.create(minimalInput, { merge: true })) as never as {
      id: string;
      mergedFields?: string[];
    };
    expect(created.id).toBe("flight-9");
    expect(created.mergedFields).toEqual(["aircraft", "seatNumber"]);
  });
});
