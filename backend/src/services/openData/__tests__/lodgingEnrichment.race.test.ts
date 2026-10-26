import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { findOsmLodging, type OsmLodging } from "../openStreetMap";
import { enrichLodgingFromOsm } from "../lodgingEnrichment";

jest.mock("../openStreetMap", () => ({
  ...jest.requireActual("../openStreetMap"),
  findOsmLodging: jest.fn(),
}));

/**
 * The enrichment asks Overpass between reading the lodging and writing it
 * (Codex review before 2.7.0-rc.22). A value the user saves in that window —
 * a reference, a website — is the user's, and "fill only while empty" has to
 * hold at the moment of the write, not at the moment of the read.
 */

const HIT: OsmLodging = {
  osmRef: "osm:node/4711",
  name: "Hotel Race",
  distanceM: 12,
  tags: {
    name: "Hotel Race",
    tourism: "hotel",
    stars: "4",
    website: "https://osm.example/hotel",
    wikidata: "Q4711",
  },
};

describe("enrichLodgingFromOsm — a save that lands while Overpass is asked", () => {
  const username = "enrichrace1";
  let userId: string;
  const lookup = findOsmLodging as jest.MockedFunction<typeof findOsmLodging>;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
  });

  it("keeps the value saved meanwhile and reports only what it filled", async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, type: "hotel", name: "Hotel Race", lat: 52.5, lon: 13.4 },
    });
    let answer: (hit: OsmLodging) => void = () => undefined;
    let asked: () => void = () => undefined;
    const overpassAsked = new Promise<void>((resolve) => (asked = resolve));
    lookup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
          asked();
        })
    );

    const enrichment = enrichLodgingFromOsm(userId, lodging.id);
    await overpassAsked;
    await prisma.lodging.update({
      where: { id: lodging.id },
      data: { externalRef: "google:place-1", website: "https://mine.example" },
    });
    answer(HIT);
    const result = await enrichment;

    const stored = await prisma.lodging.findUniqueOrThrow({ where: { id: lodging.id } });
    expect(stored.externalRef).toBe("google:place-1");
    expect(stored.website).toBe("https://mine.example");
    expect(stored.stars).toBe(4);
    expect(stored.wikidataId).toBe("Q4711");
    expect([...result.filled].sort()).toEqual(["stars", "wikidataId"]);
    expect(result.referenceStored).toBe(false);
  });

  it("tells the matcher the lodging's town and country, which never identify a house", async () => {
    // OSM audit 2026-10-26: "Lestar Hotel Hanoi" took "Hanoi Grandeur Hotel"
    // 41 m away, because the town was the only word the matcher was told about.
    const lodging = await prisma.lodging.create({
      data: {
        userId,
        type: "hotel",
        name: "Lestar Hotel Hanoi",
        lat: 21.03,
        lon: 105.85,
        city: "Hanoi",
        country: "Vietnam",
        isoCountryCode: "VN",
      },
    });
    lookup.mockResolvedValueOnce(null);

    await enrichLodgingFromOsm(userId, lodging.id);

    const places = lookup.mock.calls.at(-1)?.[3] ?? [];
    // City, the stored country text, and the country's English and German names.
    expect(places).toEqual(expect.arrayContaining(["Hanoi", "Vietnam"]));
    expect(places).toHaveLength(4);
  });
});
