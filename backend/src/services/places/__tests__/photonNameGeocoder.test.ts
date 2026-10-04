jest.mock("../../geo/photon", () => ({
  photonRequest: jest.fn().mockResolvedValue([]),
}));

import { photonRequest } from "../../geo/photon";
import { throttledPhotonGeocoder } from "../photonNameGeocoder";

const mockRequest = photonRequest as jest.Mock;

describe("throttledPhotonGeocoder — Photon fair use for the backfill", () => {
  beforeEach(() => mockRequest.mockClear());

  it("spaces every request, not every place, by the interval", async () => {
    let now = 0;
    const waits: number[] = [];
    const geo = throttledPhotonGeocoder({
      minIntervalMs: 1000,
      clock: () => now,
      sleep: async (ms) => {
        waits.push(ms);
        now += ms;
      },
    });

    await geo.reverseDefault(37.5, 127);
    now += 200;
    await geo.reverseEnglish(37.5, 127);
    await geo.searchEnglish("반포대교", 37.5, 127);

    expect(waits).toEqual([800, 1000]);
    expect(mockRequest.mock.calls).toEqual([
      ["reverse", { lat: "37.5", lon: "127", lang: "default" }, 20],
      ["reverse", { lat: "37.5", lon: "127", lang: "en" }, 20],
      ["search", { q: "반포대교", lat: "37.5", lon: "127", lang: "en" }, 10],
    ]);
  });
});
