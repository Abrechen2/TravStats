import { clearWikipediaCache, wikidataIdIn, wikipediaSummary } from "../wikipedia";
import { starsFromOsm, websiteFromOsm } from "../lodgingEnrichment";
import { joinLegs, sampleEvenly } from "../plannedProfile";
import { mockFetch, type FetchMock } from "./fetchMock";

const sitelinks = (links: Record<string, string>) => ({
  entities: {
    Q698095: {
      sitelinks: Object.fromEntries(
        Object.entries(links).map(([site, title]) => [site, { site, title }])
      ),
    },
  },
});

const summary = (title: string, type = "standard") => ({
  type,
  title,
  extract: `${title} is a hotel.`,
  thumbnail: { source: "https://upload.wikimedia.org/x.jpg" },
  content_urls: { desktop: { page: `https://de.wikipedia.org/wiki/${title}` } },
});

describe("Wikipedia through Wikidata", () => {
  let fetches: FetchMock | null = null;
  beforeEach(() => clearWikipediaCache());
  afterEach(() => fetches?.restore());

  it("reads the article in the reader's language", async () => {
    fetches = mockFetch([
      [/wikidata\.org/, sitelinks({ dewiki: "Hotel Adlon", enwiki: "Hotel Adlon" })],
      [/de\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Hotel_Adlon/, summary("Hotel Adlon")],
    ]);
    const s = await wikipediaSummary("Q698095", "de");
    expect(s).toMatchObject({ title: "Hotel Adlon", lang: "de" });
    expect(s!.thumbnailUrl).toContain("upload.wikimedia.org");
  });

  it("falls back to English when there is no German article", async () => {
    fetches = mockFetch([
      [/wikidata\.org/, sitelinks({ enwiki: "Some Inn" })],
      [/en\.wikipedia\.org/, summary("Some Inn")],
    ]);
    expect((await wikipediaSummary("Q698095", "de"))?.lang).toBe("en");
  });

  it("shows nothing for a disambiguation page, and remembers that for a day", async () => {
    fetches = mockFetch([
      [/wikidata\.org/, sitelinks({ dewiki: "Post" })],
      [/de\.wikipedia\.org/, summary("Post", "disambiguation")],
    ]);
    expect(await wikipediaSummary("Q698095", "de")).toBeNull();
    const callsAfterFirst = fetches.calls.length;
    expect(await wikipediaSummary("Q698095", "de")).toBeNull();
    expect(fetches.calls).toHaveLength(callsAfterFirst);
  });

  it("finds a Q-id inside a curated item id", () => {
    expect(wikidataIdIn("biosphere-reserves:Q16058035")).toBe("Q16058035");
    expect(wikidataIdIn("world-heritage:1699")).toBeNull();
  });
});

describe("OpenStreetMap values that may enter a lodging", () => {
  it("takes stars only as a clean 1 to 5", () => {
    expect(starsFromOsm("5")).toBe(5);
    expect(starsFromOsm("4S")).toBe(4);
    expect(starsFromOsm("3.5")).toBeNull();
    expect(starsFromOsm("7")).toBeNull();
    expect(starsFromOsm(undefined)).toBeNull();
  });

  it("takes a website only as an absolute http(s) address", () => {
    expect(websiteFromOsm("https://www.kempinski.com/adlon")).toBe(
      "https://www.kempinski.com/adlon"
    );
    expect(websiteFromOsm("www.example.com")).toBeNull();
    expect(websiteFromOsm("javascript:alert(1)")).toBeNull();
  });
});

describe("the planned line", () => {
  it("joins legs without repeating the point they share", () => {
    expect(
      joinLegs([
        [
          [0, 0],
          [1, 0],
        ],
        [
          [1, 0],
          [2, 0],
        ],
      ])
    ).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it("samples at equal distances, ends included", () => {
    const { points, atKm, totalKm } = sampleEvenly(
      [
        [0, 0],
        [0, 1],
      ],
      5
    );
    expect(points[0]).toEqual([0, 0]);
    expect(points[4][1]).toBeCloseTo(1, 6);
    expect(points[2][1]).toBeCloseTo(0.5, 6);
    expect(atKm[4]).toBeCloseTo(totalKm, 6);
  });
});
