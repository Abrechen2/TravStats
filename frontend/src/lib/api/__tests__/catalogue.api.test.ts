import { describe, it, expect, vi, beforeEach } from "vitest";
import { airlinesApi, aircraftApi } from "../catalogue";
import { api } from "../client";

vi.mock("../client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe("airlinesApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("search() sends q as query param", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [] } });
    await airlinesApi.search("lufthansa");
    expect(api.get).toHaveBeenCalledWith("/airlines", { params: { q: "lufthansa" } });
  });

  it("search() omits q when empty", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [] } });
    await airlinesApi.search("");
    expect(api.get).toHaveBeenCalledWith("/airlines", { params: {} });
  });

  it("create() posts a new airline and unwraps envelope", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: { id: 1 } } });
    const result = await airlinesApi.create({ name: "Lufthansa", iata: "LH" });
    expect(api.post).toHaveBeenCalledWith("/airlines", { name: "Lufthansa", iata: "LH" });
    expect(result).toEqual({ id: 1 });
  });
});

describe("aircraftApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("search() sends q as query param", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { success: true, data: [] } });
    await aircraftApi.search("a320");
    expect(api.get).toHaveBeenCalledWith("/aircraft", { params: { q: "a320" } });
  });

  it("create() posts a new aircraft and unwraps envelope", async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, data: { id: 1 } } });
    const result = await aircraftApi.create({ name: "Airbus A320", icao: "A320" });
    expect(api.post).toHaveBeenCalledWith("/aircraft", { name: "Airbus A320", icao: "A320" });
    expect(result).toEqual({ id: 1 });
  });
});
