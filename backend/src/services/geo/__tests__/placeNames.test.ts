import { mergePlaceNames, needsLatinNames } from "../placeNames";
import type { PlaceResult } from "../photon";

const hit = (externalRef: string | undefined, name: string): PlaceResult => ({
  name,
  ...(externalRef ? { externalRef } : {}),
  lat: 37.58,
  lon: 126.98,
});

describe("place names for a traveller (forgejo#199)", () => {
  it("asks for more when a hit is in a non-Latin script or in a country that writes one", () => {
    expect(needsLatinNames([hit("osm:way/1", "Brandenburger Tor")])).toBe(false);
    expect(
      needsLatinNames([hit("osm:way/1", "Brandenburger Tor"), hit("osm:way/2", "경복궁")])
    ).toBe(true);
    // Latin already ("Seoul-Bahnhof"), but the sign says 서울역 — ask for it.
    expect(needsLatinNames([{ ...hit("osm:way/3", "Seoul-Bahnhof"), countryCode: "KR" }])).toBe(
      true
    );
    expect(needsLatinNames([{ ...hit("osm:way/4", "Eiffelturm"), countryCode: "FR" }])).toBe(false);
  });

  it("takes the English name and keeps the sign's name beside it", () => {
    const merged = mergePlaceNames(
      [hit("osm:way/2", "경복궁")],
      [hit("osm:way/2", "Gyeongbokgung Palace")],
      [hit("osm:way/2", "경복궁")]
    );
    expect(merged[0]).toMatchObject({ name: "Gyeongbokgung Palace", localName: "경복궁" });
  });

  it("keeps a Latin name in the requested language and adds the local one", () => {
    const merged = mergePlaceNames(
      [hit("osm:way/3", "Seoul-Bahnhof")],
      [hit("osm:way/3", "Seoul Station")],
      [hit("osm:way/3", "서울역")]
    );
    expect(merged[0]).toMatchObject({ name: "Seoul-Bahnhof", localName: "서울역" });
  });

  it("leaves a name with no Latin form as it is, and invents no transliteration", () => {
    const merged = mergePlaceNames(
      [hit("osm:node/4", "할매집")],
      [hit("osm:node/4", "할매집")],
      [hit("osm:node/4", "할매집")]
    );
    expect(merged[0].name).toBe("할매집");
    expect(merged[0].localName).toBeUndefined();
  });

  it("keeps the replaced name as the local one when the default-name lookup failed", () => {
    const merged = mergePlaceNames(
      [hit("osm:way/2", "경복궁")],
      [hit("osm:way/2", "Gyeongbokgung Palace")],
      null
    );
    expect(merged[0]).toMatchObject({ name: "Gyeongbokgung Palace", localName: "경복궁" });
  });

  it("loses nothing when both extra lookups failed or a hit has no OSM identity", () => {
    expect(mergePlaceNames([hit("osm:way/2", "경복궁")], null, null)[0]).toEqual(
      hit("osm:way/2", "경복궁")
    );
    expect(mergePlaceNames([hit(undefined, "경복궁")], [hit("osm:way/2", "X")], null)[0].name).toBe(
      "경복궁"
    );
  });

  // Owner, 2026-10-04: "Das muss mit allen Länder Schriften gehen".
  it.each([
    ["Cyrillic", "Москва", "Moscow"],
    ["Greek", "Αθήνα", "Athens"],
    ["Arabic", "القاهرة", "Cairo"],
    ["Hebrew", "ירושלים", "Jerusalem"],
    ["Thai", "กรุงเทพมหานคร", "Bangkok"],
    ["Georgian", "თბილისი", "Tbilisi"],
    ["Armenian", "Երևան", "Yerevan"],
    ["Devanagari", "नई दिल्ली", "New Delhi"],
    ["Han (Chinese)", "北京", "Beijing"],
    ["Kanji (Japanese)", "東京", "Tokyo"],
    ["Hangul", "서울", "Seoul"],
  ])("%s: %s becomes %s and keeps the original", (_script, local, english) => {
    const merged = mergePlaceNames(
      [hit("osm:relation/9", local)],
      [hit("osm:relation/9", english)],
      [hit("osm:relation/9", local)]
    );
    expect(merged[0]).toMatchObject({ name: english, localName: local });
  });

  it.each([
    "Hà Nội",
    "Hà Nội".normalize("NFD"),
    "Đà Nẵng",
    "Łódź",
    "İstanbul",
    "Ærø",
    "Café № 5",
    "Hawaiʻi-Volcanoes-Nationalpark",
    "Oʻahu",
  ])("treats %s as Latin — accents and letterlike signs are not another script", (name) => {
    expect(needsLatinNames([hit("osm:node/1", name)])).toBe(false);
  });
});
