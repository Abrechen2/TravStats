import { findOsmLodging } from "../openStreetMap";
import { mockFetch, type FetchMock } from "./fetchMock";

/**
 * forgejo, 2026-09-30 fix round 1. `findOsmLodging` searches Overpass around
 * the hotel's OWN pin and passes `{ nearby: true }` to `namesCouldBeOneHouse`
 * — coordinates already proved the place, so a brand word like "Novotel" or
 * location decor should still count as identity here, the way it did before
 * Task 1 added place-stripping. Without `nearby: true`, `namesCouldBeOneHouse`
 * strips BRAND_TOKENS/LOCATION_TOKENS unconditionally (not just place words),
 * so a co-branded OSM node tagged by brand alone ("Novotel") would silently
 * stop matching a lodging named "Novotel Basel City" — a regression of the
 * old rule this function never had a test to catch.
 */

// A pin near Basel SBB, and the Overpass answer for it.
const PIN = { lat: 47.5476, lon: 7.5896 };

const overpassAnswer = (elements: ReadonlyArray<{ name: string; lat: number; lon: number }>) => ({
  elements: elements.map((el, i) => ({
    type: "node",
    id: 1000 + i,
    lat: el.lat,
    lon: el.lon,
    tags: { tourism: "hotel", name: el.name },
  })),
});

describe("findOsmLodging", () => {
  let fetches: FetchMock | null = null;
  afterEach(() => fetches?.restore());

  it("finds the hotel's own OSM object under a co-brand name that shares only the brand word", async () => {
    // Overpass tags the shared Accor building's Novotel wing with the brand
    // alone — no "Basel" or "City" in the OSM name at all.
    fetches = mockFetch([
      [
        /overpass-api\.de/,
        overpassAnswer([{ name: "Novotel / ibis Budget", lat: PIN.lat, lon: PIN.lon }]),
      ],
    ]);

    const result = await findOsmLodging(PIN.lat, PIN.lon, "Novotel Basel City");

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ name: "Novotel / ibis Budget" });
  });

  it("does not let an unrelated hotel further from the pin win over the hotel's own object", async () => {
    // Two lodging-type nodes near the pin: the real Novotel (right on the
    // pin) and an unrelated "Hotel Krafft Basel" a couple hundred metres
    // off. Both carry "Basel" in their name, but only the nearer one is the
    // house this lookup is for.
    fetches = mockFetch([
      [
        /overpass-api\.de/,
        overpassAnswer([
          { name: "Hotel Krafft Basel", lat: PIN.lat + 0.002, lon: PIN.lon + 0.002 },
          { name: "Novotel Basel City", lat: PIN.lat, lon: PIN.lon },
        ]),
      ],
    ]);

    const result = await findOsmLodging(PIN.lat, PIN.lon, "Novotel Basel City");

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ name: "Novotel Basel City" });
    expect((result as { name: string }).name).not.toBe("Hotel Krafft Basel");
  });
});
