import { brandOfTags, matchBrandRules, type BrandRuleInput } from "../brandMatch";

const rule = (over: Partial<BrandRuleInput> = {}): BrandRuleInput => ({
  id: "r1",
  listId: "l1",
  listName: "McDonald's",
  brandWikidataId: "Q38076",
  brandName: "McDonald's",
  minDwellMinutes: 5,
  maxDwellMinutes: 60,
  maxDistanceM: 100,
  autoAcceptDistanceM: 60,
  autoAccept: true,
  ...over,
});
const venue = { wikidata: "Q38076", name: "McDonald's", disused: false };
const match = (over: Partial<Parameters<typeof matchBrandRules>[0]> = {}) =>
  matchBrandRules({
    rules: [rule()],
    venue,
    topCandidate: true,
    dwellMinutes: 25,
    distanceM: 14,
    ...over,
  });

describe("matchBrandRules", () => {
  it("matches the venue's brand:wikidata id and is confident enough to auto-accept", () => {
    expect(match()).toEqual([
      expect.objectContaining({ listId: "l1", strength: "id", auto: true }),
    ]);
  });

  it("does not auto-accept on a list that has not switched it on", () => {
    expect(match({ rules: [rule({ autoAccept: false })] })[0]).toMatchObject({
      strength: "id",
      auto: false,
    });
  });

  it("keeps the dwell window closed at BOTH ends: 4 minutes and 4 hours do not match, the bounds do", () => {
    expect(match({ dwellMinutes: 4 })).toEqual([]);
    expect(match({ dwellMinutes: 240 })).toEqual([]);
    expect(match({ dwellMinutes: 61 })).toEqual([]);
    expect(match({ dwellMinutes: 5 })).toHaveLength(1);
    expect(match({ dwellMinutes: 60 })).toHaveLength(1);
  });

  it("does not match a venue further than the rule's suggestion distance (100 m), and matches exactly at it", () => {
    expect(match({ distanceM: 101 })).toEqual([]);
    expect(match({ distanceM: 100 })).toHaveLength(1);
  });

  it("auto-accepts only within the tighter tier: 60 m auto, 61 m suggestion only", () => {
    expect(match({ distanceM: 60 })[0]).toMatchObject({ strength: "id", auto: true });
    expect(match({ distanceM: 61 })[0]).toMatchObject({ strength: "id", auto: false });
    expect(match({ distanceM: 100 })[0].auto).toBe(false);
  });

  it("never matches when the venue was not the stop's top candidate (no nearest-node fallback)", () => {
    expect(match({ topCandidate: false })).toEqual([]);
  });

  it("never matches a disused or abandoned venue", () => {
    expect(match({ venue: { ...venue, disused: true } })).toEqual([]);
  });

  it("matches a venue without brand:wikidata by the exact brand string only, as a weaker match never auto-accepted", () => {
    const m = match({ venue: { wikidata: null, name: "mcdonald’s", disused: false } });
    expect(m).toEqual([expect.objectContaining({ strength: "name", auto: false })]);
    expect(match({ venue: { wikidata: null, name: "McDonalds Cafe", disused: false } })).toEqual(
      []
    );
  });

  it("does not let a brand string override a venue that carries a DIFFERENT brand id", () => {
    expect(match({ venue: { wikidata: "Q177054", name: "McDonald's", disused: false } })).toEqual(
      []
    );
  });

  it("abstains without any venue facts", () => {
    expect(match({ venue: null })).toEqual([]);
  });
});

describe("brandOfTags", () => {
  it("reads brand, brand:wikidata and closure markers from the OSM tags", () => {
    expect(
      brandOfTags({ amenity: "fast_food", brand: "McDonald's", "brand:wikidata": "Q38076" })
    ).toEqual({ wikidata: "Q38076", name: "McDonald's", disused: false });
    expect(brandOfTags({ "disused:amenity": "fast_food", brand: "McDonald's" })?.disused).toBe(
      true
    );
    expect(brandOfTags({ "brand:wikidata": "not-a-qid" })).toBeNull();
    expect(brandOfTags({ amenity: "cafe" })).toBeNull();
  });
});
