import fs from "fs/promises";
import {
  __resetSubjectImageCachesForTests,
  answerSubjectImage,
  subjectImageCacheDir,
} from "../subjectImageService";
import { describesKind, subjectSearchName } from "../subjectImageLookup";
import { __resetWikimediaQueueForTests } from "../../operatorLogos/wikimedia";

/**
 * Subject pictures (rich map details, 2026-10-21): the item must BE the name
 * and be the right kind of thing, its picture freely licensed and credited,
 * an outage
 * reported as unavailable (never as "no picture") — and never a wrong one. Mocked HTTP; no
 * request leaves the test.
 */

const settings = { operatorLogosOpenDataEnabled: true };
jest.mock("../../instanceSettingsService", () => ({
  getInstanceSettings: async () => settings,
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const jpeg = (): Response =>
  new Response(Buffer.from([0xff, 0xd8, 0xff]), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });

function entity(description: string, file: string | null) {
  return {
    descriptions: { en: { language: "en", value: description } },
    claims: file ? { P18: [{ rank: "normal", mainsnak: { datavalue: { value: file } } }] } : {},
  };
}

function fileInfo(licence: string): unknown {
  return {
    query: {
      pages: {
        "1": {
          imageinfo: [
            {
              thumburl: "https://upload.wikimedia.org/thumb/ship.jpg",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Color_Fantasy.jpg",
              extmetadata: {
                License: { value: licence },
                LicenseShortName: { value: licence },
                Artist: { value: "Jane Doe" },
              },
            },
          ],
        },
      },
    },
  };
}

type Route = (url: string) => Response;
let fetchMock: jest.Mock;
function use(route: Route): void {
  fetchMock = jest.fn(async (input: string | URL) => route(String(input)));
  global.fetch = fetchMock as unknown as typeof fetch;
}

function wikidata(
  search: Array<{ id: string; text: string }>,
  entities: Record<string, unknown>,
  licence = "cc-by-sa-4.0"
): Route {
  return (url) => {
    if (url.includes("wbsearchentities"))
      return json({ search: search.map((s) => ({ id: s.id, match: { text: s.text } })) });
    if (url.includes("wbgetentities")) return json({ entities });
    if (url.includes("commons.wikimedia.org")) return json(fileInfo(licence));
    if (url.includes("upload.wikimedia.org")) return jpeg();
    throw new Error(`unexpected ${url}`);
  };
}

describe("subject pictures", () => {
  const realFetch = global.fetch;

  beforeEach(async () => {
    settings.operatorLogosOpenDataEnabled = true;
    __resetSubjectImageCachesForTests();
    __resetWikimediaQueueForTests();
    await fs.rm(subjectImageCacheDir(), { recursive: true, force: true });
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await fs.rm(subjectImageCacheDir(), { recursive: true, force: true });
  });

  it("finds the vessel's photo, credited", async () => {
    use(
      wikidata([{ id: "Q1", text: "Color Fantasy" }], {
        Q1: entity("cruiseferry built in 2004", "Color Fantasy.jpg"),
      })
    );
    const { picture } = await answerSubjectImage("vessel", "Color Fantasy");
    expect(picture?.image.contentType).toBe("image/jpeg");
    expect(picture?.credit).toMatchObject({
      qid: "Q1",
      file: "Color Fantasy.jpg",
      licence: "cc-by-sa-4.0",
      artist: "Jane Doe",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Color_Fantasy.jpg",
    });
  });

  it("refuses an item of the wrong kind — 'ICE' the agency is not a train", async () => {
    use(
      wikidata([{ id: "Q2", text: "ICE" }], {
        Q2: entity("United States federal law enforcement agency", "ICE seal.jpg"),
      })
    );
    const { picture } = await answerSubjectImage("train", "ICE");
    expect(picture).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("commons"))).toBe(false);
  });

  it("refuses a fuzzy neighbour whose label is not the name", async () => {
    use(
      wikidata([{ id: "Q3", text: "Color Fantasy (album)" }], {
        Q3: entity("ship", "x.jpg"),
      })
    );
    expect((await answerSubjectImage("vessel", "Color Fantasy")).picture).toBeNull();
  });

  it("refuses a picture without a free licence", async () => {
    use(
      wikidata(
        [{ id: "Q1", text: "Color Fantasy" }],
        { Q1: entity("cruiseferry", "Color Fantasy.jpg") },
        "cc-by-nc-2.0"
      )
    );
    expect((await answerSubjectImage("vessel", "Color Fantasy")).picture).toBeNull();
  });

  it("answers no picture, without asking, while the instance switch is off", async () => {
    settings.operatorLogosOpenDataEnabled = false;
    use(() => {
      throw new Error("must not ask");
    });
    expect(await answerSubjectImage("vessel", "Color Fantasy")).toMatchObject({
      picture: null,
      pending: false,
    });
  });

  it("reports an outage as unavailable, not as no picture, and asks again after a short back-off", async () => {
    use(() => json({}, 503));
    expect(await answerSubjectImage("vessel", "Color Fantasy")).toMatchObject({
      picture: null,
      pending: false,
      unavailable: true,
    });
    const calls = fetchMock.mock.calls.length;
    // Within the back-off: still "unavailable", without asking again.
    expect(await answerSubjectImage("vessel", "Color Fantasy")).toMatchObject({
      unavailable: true,
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
    // Wikimedia is back a few minutes later: the outage was not cached as a miss.
    use(
      wikidata([{ id: "Q1", text: "Color Fantasy" }], {
        Q1: entity("cruiseferry built in 2004", "Color Fantasy.jpg"),
      })
    );
    const later = Date.now() + 5 * 60 * 1000;
    const now = jest.spyOn(Date, "now").mockReturnValue(later);
    try {
      const answer = await answerSubjectImage("vessel", "Color Fantasy");
      expect(answer.picture?.credit.qid).toBe("Q1");
      expect(answer.unavailable).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  it("reports a genuine miss as not unavailable", async () => {
    use(
      wikidata([{ id: "Q2", text: "ICE" }], {
        Q2: entity("United States federal law enforcement agency", "ICE seal.jpg"),
      })
    );
    expect(await answerSubjectImage("train", "ICE")).toEqual({
      picture: null,
      pending: false,
      unavailable: false,
    });
  });

  it("answers pending past the wait, without failing", async () => {
    use(() => new Promise<Response>(() => undefined) as unknown as Response);
    expect(await answerSubjectImage("vessel", "Slow Ship", { waitMs: 10 })).toMatchObject({
      picture: null,
      pending: true,
      unavailable: false,
    });
  });
});

describe("subject names", () => {
  it("searches a rental voucher's car model, not 'or similar'", () => {
    expect(subjectSearchName("vehicle", "VW Golf oder ähnlich")).toBe("Volkswagen Golf");
    expect(subjectSearchName("vehicle", "Fiat 500 (or similar)")).toBe("Fiat 500");
    expect(subjectSearchName("vehicle", "Toyota Yaris or similar automatic")).toBe("Toyota Yaris");
  });

  it("knows a car model, a ship and a train from their descriptions", () => {
    expect(describesKind("vehicle", ["compact car produced by Volkswagen"])).toBe(true);
    expect(describesKind("vessel", ["Fährschiff der Color Line"])).toBe(true);
    expect(describesKind("train", ["German high-speed rail service"])).toBe(true);
    expect(describesKind("train", ["sport played on a course"])).toBe(false);
  });
});
