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

  const tagged = (elements: ReadonlyArray<Record<string, string>>) => ({
    elements: elements.map((tags, i) => ({
      type: "node",
      id: 2000 + i,
      lat: PIN.lat,
      lon: PIN.lon,
      tags: { tourism: "hotel", ...tags },
    })),
  });

  it("finds a house whose OSM name is in another script through its name:en", async () => {
    // Audit 2026-10-26: seven misses had a non-Latin `name` only.
    fetches = mockFetch([
      [/overpass-api\.de/, tagged([{ name: "ივერია ინნ", "name:en": "Iveria Inn" }])],
    ]);
    const result = await findOsmLodging(PIN.lat, PIN.lon, "Hotel Iveria Inn", ["Tbilisi"]);
    expect(result).toMatchObject({ name: "ივერია ინნ", osmRef: "osm:node/2000" });
  });

  it("reads name:de, int_name and every alt_name as well", async () => {
    fetches = mockFetch([
      [
        /overpass-api\.de/,
        tagged([
          { name: "فندق أتلانتس", "name:de": "Hotel Atlantis" },
          { name: "登り坂ホテル", int_name: "Noborisaka Hotel" },
          { name: "X", alt_name: "Old Name;Haus Kiekenstein" },
        ]),
      ],
    ]);
    expect(await findOsmLodging(PIN.lat, PIN.lon, "Atlantis The Palm")).toMatchObject({
      osmRef: "osm:node/2000",
    });
    expect(await findOsmLodging(PIN.lat, PIN.lon, "THE NOBORISAKA HOTEL")).toMatchObject({
      osmRef: "osm:node/2001",
    });
    expect(await findOsmLodging(PIN.lat, PIN.lon, "Kiekenstein")).toMatchObject({
      osmRef: "osm:node/2002",
    });
  });

  it("does not take the town's other hotel, even when only OSM names the town", async () => {
    // Audit case 3: the lodging's own record carries no city here, but the
    // neighbour's addr:city says "Zürich" — a town word on every house.
    fetches = mockFetch([
      [/overpass-api\.de/, tagged([{ name: "Moxy Zürich", "addr:city": "Zürich" }])],
    ]);
    expect(await findOsmLodging(PIN.lat, PIN.lon, "H+ Hotel Zürich")).toBeNull();
  });

  it("does not let a landmark name:en carry the match (audit case 2)", async () => {
    fetches = mockFetch([
      [
        /overpass-api\.de/,
        tagged([{ name: "Great Pyramids Inn", "name:en": "Pyramids View Inn" }]),
      ],
    ]);
    expect(await findOsmLodging(PIN.lat, PIN.lon, "PANORAMA view pyramids", ["Giza"])).toBeNull();
  });
});
