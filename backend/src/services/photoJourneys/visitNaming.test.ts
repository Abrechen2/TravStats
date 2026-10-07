import type { PlaceResult } from "../geo/photon";
import type { PlaceNameGeocoder } from "../places/placeNameBackfill";
import { nameVisitStop } from "./visitNaming";

/**
 * What a stop is called (forgejo#211). Photon is a fake; under test is which
 * hit is taken — the nearest NAMED THING, never the street or the town — and
 * how its two names and its ref are read.
 */
const PALACE = { lat: 37.5796, lon: 126.977 };
const metresNorth = (m: number) => ({ lat: PALACE.lat + m / 111_000, lon: PALACE.lon });

const hit = (over: Partial<PlaceResult> & { name: string }): PlaceResult => ({
  ...PALACE,
  ...over,
});

function fake(english: PlaceResult[] | null, local: PlaceResult[] | null): PlaceNameGeocoder {
  return {
    searchEnglish: async () => null,
    reverseEnglish: async () => english,
    reverseDefault: async () => local,
  };
}

describe("naming a stop", () => {
  it("takes the nearest named object, with its own-script name and its ref", async () => {
    const english = [
      hit({ name: "Sajik-ro", type: "primary", externalRef: "osm:way/1", ...metresNorth(5) }),
      hit({
        name: "Gyeongbokgung",
        type: "castle",
        externalRef: "osm:way/2",
        city: "Seoul",
        country: "South Korea",
        countryCode: "kr",
        ...metresNorth(40),
      }),
      hit({ name: "Seoul", type: "city", externalRef: "osm:relation/3", ...metresNorth(10) }),
    ];
    const local = [hit({ name: "경복궁", externalRef: "osm:way/2", ...metresNorth(40) })];

    await expect(nameVisitStop(fake(english, local), PALACE)).resolves.toEqual({
      name: "Gyeongbokgung",
      localName: "경복궁",
      ref: "osm:way/2",
      category: "landmark",
      city: "Seoul",
      country: "South Korea",
      countryCode: "KR",
    });
  });

  it("keeps no local name when the sign reads the same as the English name", async () => {
    const english = [hit({ name: "Eiffel Tower", type: "attraction", externalRef: "osm:way/5" })];
    const local = [hit({ name: "Tour Eiffel", externalRef: "osm:way/5" })];
    const named = await nameVisitStop(fake(english, local), PALACE);
    // Latin, so not "the sign in its own script" — abstention, not a second Latin name.
    expect(named?.localName).toBeNull();
  });

  it("answers null when the nearest things within reach are a road and a town", async () => {
    const english = [
      hit({ name: "Sajik-ro", type: "primary" }),
      hit({ name: "Jongno-gu", type: "district" }),
      hit({ name: "Far Shrine", type: "shrine", ...metresNorth(400) }),
    ];
    await expect(nameVisitStop(fake(english, english), PALACE)).resolves.toBeNull();
  });

  it("answers null — not a dropped finding — when both lookups failed", async () => {
    await expect(nameVisitStop(fake(null, null), PALACE)).resolves.toBeNull();
  });

  it("names from the own-script answer alone when the English lookup failed", async () => {
    const local = [hit({ name: "경복궁", type: "castle", externalRef: "osm:way/2" })];
    const named = await nameVisitStop(fake(null, local), PALACE);
    expect(named).toMatchObject({ name: "경복궁", localName: null, ref: "osm:way/2" });
  });

  it("leaves the category open for a tag that maps to nothing in particular", async () => {
    const english = [hit({ name: "Some Yard", type: "yes", externalRef: "osm:way/9" })];
    expect((await nameVisitStop(fake(english, null), PALACE))?.category).toBeNull();
  });
});
