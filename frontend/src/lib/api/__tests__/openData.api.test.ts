import { describe, it, expect, vi, beforeEach } from "vitest";
import { openDataApi, OpenDataUnavailableError } from "../openData";
import { api } from "../client";

vi.mock("../client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

/**
 * The server answers `unavailable: true` when Wikipedia or Open-Meteo did not
 * answer; the client turns that into an error, so a card cannot mistake it
 * for "nothing to show".
 */
describe("openDataApi — an unavailable service is not an empty answer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws for an unavailable Wikipedia summary", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { summary: null, unavailable: true } });
    await expect(openDataApi.placeWikipedia("p1", "de")).rejects.toBeInstanceOf(
      OpenDataUnavailableError
    );
  });

  it("returns null for a thing without an article", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { summary: null, unavailable: false } });
    expect(await openDataApi.lodgingWikipedia("l1", "de")).toBeNull();
  });

  it("throws for an unavailable planned profile", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { profile: null, unavailable: true } });
    await expect(openDataApi.plannedProfile("r1")).rejects.toBeInstanceOf(OpenDataUnavailableError);
  });
});
