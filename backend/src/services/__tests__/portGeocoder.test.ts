import { geocodePort, resetPortGeocoderForTests } from "../portGeocoder";

/**
 * A Nominatim failure used to come back as an empty list — indistinguishable
 * from "no such place" — so the port picker offered only "add by hand" while
 * the lookup had not happened at all. fetch is stubbed: no test reaches OSM.
 */
describe("geocodePort — failures are reported, not folded into 'no match'", () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    resetPortGeocoderForTests();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  const okBody = [
    {
      lat: "40.47",
      lon: "17.24",
      name: "Taranto",
      address: { city: "Taranto", country: "Italia" },
    },
  ];

  it("returns candidates with no failure on success", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => okBody });
    const out = await geocodePort("Taranto");
    expect(out.failure).toBeNull();
    expect(out.ports[0]).toMatchObject({ name: "Taranto", country: "Italia", source: "geocoder" });
  });

  it("marks a 429 as rate_limited", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const out = await geocodePort("Taranto");
    expect(out).toEqual({ ports: [], failure: "rate_limited" });
  });

  it("marks a network error as unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const out = await geocodePort("Taranto");
    expect(out).toEqual({ ports: [], failure: "unavailable" });
  });

  it("does not cache a failure — the next try reaches the geocoder again", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => okBody });
    await geocodePort("Taranto");
    resetThrottleOnly();
    const second = await geocodePort("Taranto");
    expect(second.failure).toBeNull();
    expect(second.ports).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// The 1.1 s throttle is real time; a second call inside it would just wait.
// Advancing Date.now past it keeps the test fast without touching the cache.
function resetThrottleOnly(): void {
  const now = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(now + 5000);
}
