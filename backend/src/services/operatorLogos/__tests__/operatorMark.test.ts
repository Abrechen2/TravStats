import fs from "fs/promises";
import {
  __resetOperatorMarkCachesForTests,
  operatorMarkCacheDir,
  operatorMarkKey,
  resolveOperatorMark,
} from "../operatorMarkService";
import { __resetWikimediaQueueForTests } from "../wikimedia";
import { bestStringClaim, plainText } from "../wikidataOperator";

/**
 * forgejo#323: operator logos from Wikidata and Commons follow the airline-logo
 * rule — tiers returning null on a miss, never a placeholder — and every
 * failure path is driven here with mocked HTTP: no item, a fuzzy match, no
 * logo, a refused licence, a 429, a network error, a non-image, the admin
 * switch off. No request leaves the test.
 */

const settings = { operatorLogosOpenDataEnabled: true };
jest.mock("../../instanceSettingsService", () => ({
  getInstanceSettings: async () => settings,
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
import logger from "../../../utils/logger";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const png = (): Response =>
  new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

const SEARCH_HIT = {
  search: [
    { id: "Q1", match: { text: "Colour theory line" } }, // a fuzzy neighbour, never taken
    { id: "Q833903", match: { text: "Stena Line" } },
  ],
};
const ENTITY = {
  entities: {
    Q833903: {
      claims: {
        P154: [
          { rank: "deprecated", mainsnak: { datavalue: { value: "Old logo.svg" } } },
          { rank: "preferred", mainsnak: { datavalue: { value: "Stena line logo.svg" } } },
        ],
        P465: [{ rank: "normal", mainsnak: { datavalue: { value: "0055A4" } } }],
      },
    },
  },
};
function fileInfo(licence: string, nonFree = "false"): unknown {
  return {
    query: {
      pages: {
        "1": {
          imageinfo: [
            {
              thumburl: "https://upload.wikimedia.org/thumb/stena.png",
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Stena_line_logo.svg",
              extmetadata: {
                License: { value: licence },
                LicenseShortName: { value: licence === "pd" ? "Public domain" : licence },
                NonFree: { value: nonFree },
                Artist: { value: '<a href="x">Stena Line</a>' },
              },
            },
          ],
        },
      },
    },
  };
}

type Route = (url: string) => Response | Promise<Response>;
function routeFetch(route: Route): jest.Mock {
  return jest.fn(async (input: string | URL) => route(String(input)));
}

function happy(licence = "pd"): Route {
  return (url) => {
    if (url.includes("wbsearchentities")) return json(SEARCH_HIT);
    if (url.includes("wbgetentities")) return json(ENTITY);
    if (url.includes("commons.wikimedia.org")) return json(fileInfo(licence));
    if (url.includes("upload.wikimedia.org")) return png();
    throw new Error(`unexpected ${url}`);
  };
}

describe("resolveOperatorMark from Wikidata (forgejo#323)", () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    settings.operatorLogosOpenDataEnabled = true;
    __resetOperatorMarkCachesForTests();
    __resetWikimediaQueueForTests();
    await fs.rm(operatorMarkCacheDir(), { recursive: true, force: true });
    jest.clearAllMocks();
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await fs.rm(operatorMarkCacheDir(), { recursive: true, force: true });
  });

  function use(route: Route): void {
    fetchMock = routeFetch(route);
    global.fetch = fetchMock as unknown as typeof fetch;
  }

  it("finds the exact item's preferred logo, credited, with its official colour", async () => {
    use(happy());
    const mark = await resolveOperatorMark("ferry", "Stena Line");
    expect(mark?.source).toBe("wikidata");
    expect(mark?.image.contentType).toBe("image/png");
    expect(mark?.credit).toEqual({
      qid: "Q833903",
      file: "Stena line logo.svg",
      licence: "Public domain",
      licenceUrl: null,
      artist: "Stena Line",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Stena_line_logo.svg",
      colour: "#0055a4",
    });
    // The Commons thumbnail — a raster rendering — is what is downloaded, never the SVG.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContainEqual(
      "https://upload.wikimedia.org/thumb/stena.png"
    );
  });

  it("names itself to Wikimedia with a User-Agent", async () => {
    use(happy());
    await resolveOperatorMark("ferry", "Stena Line");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^TravStats\//);
  });

  it("serves a second request from the disk cache without asking again", async () => {
    use(happy());
    await resolveOperatorMark("ferry", "Stena Line");
    const calls = fetchMock.mock.calls.length;
    __resetOperatorMarkCachesForTests();
    expect((await resolveOperatorMark("cruise", "STENA LINE"))?.credit?.qid).toBe("Q833903");
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it.each([
    ["cc-by-sa-4.0", true],
    ["cc0", true],
    ["cc-by-nc-4.0", false],
    ["fair use", false],
    ["", false],
  ])("licence %s accepted: %s", async (licence, accepted) => {
    use(happy(licence));
    const mark = await resolveOperatorMark("bus", "Stena Line");
    expect(mark !== null).toBe(accepted);
  });

  it("refuses a file flagged non-free whatever its template says", async () => {
    use((url) =>
      url.includes("commons.wikimedia.org") ? json(fileInfo("cc-by-4.0", "true")) : happy()(url)
    );
    expect(await resolveOperatorMark("bus", "Stena Line")).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: "licence" }));
  });

  it("never takes a fuzzy match: no item is called 'Stena Ferries GmbH'", async () => {
    use(happy());
    expect(await resolveOperatorMark("ferry", "Stena Ferries GmbH")).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: "noItem" }));
  });

  it("an item without a logo is a miss, remembered — no second lookup", async () => {
    use((url) =>
      url.includes("wbgetentities") ? json({ entities: { Q833903: { claims: {} } } }) : happy()(url)
    );
    expect(await resolveOperatorMark("ferry", "Stena Line")).toBeNull();
    const calls = fetchMock.mock.calls.length;
    expect(await resolveOperatorMark("ferry", "Stena Line")).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: "noLogo" }));
  });

  it("a 429 pauses the queue and is logged as rate limiting", async () => {
    use(() => json({}, 429, { "retry-after": "120" }));
    expect(await resolveOperatorMark("ferry", "Stena Line")).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: "rateLimited" }));
    // Another operator during the pause asks nobody.
    const calls = fetchMock.mock.calls.length;
    expect(await resolveOperatorMark("ferry", "Color Line")).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("a network error is an outage, not a crash", async () => {
    use(() => {
      throw new TypeError("fetch failed");
    });
    expect(await resolveOperatorMark("ferry", "Stena Line")).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: "unavailable" }));
  });

  it("a thumbnail that is not a raster image is refused", async () => {
    use((url) =>
      url.includes("upload.wikimedia.org")
        ? new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } })
        : happy()(url)
    );
    expect(await resolveOperatorMark("ferry", "Stena Line")).toBeNull();
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: "badImage" }));
  });

  /** A body that never ends unless cancelled; records whether it was. */
  function endless(contentType: string): { response: Response; cancelled: () => boolean } {
    let cancelled = false;
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 10_000) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    return {
      response: new Response(stream, { status: 200, headers: { "content-type": contentType } }),
      cancelled: () => cancelled,
    };
  }

  it("stops reading an oversized image and cancels its stream", async () => {
    const big = endless("image/png");
    use((url) => (url.includes("upload.wikimedia.org") ? big.response : happy()(url)));
    expect(await resolveOperatorMark("ferry", "Stena Line")).toBeNull();
    expect(big.cancelled()).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: "tooLarge" }));
  });

  it("stops reading an oversized JSON answer and cancels its stream", async () => {
    const big = endless("application/json");
    use((url) => (url.includes("wbsearchentities") ? big.response : happy()(url)));
    expect(await resolveOperatorMark("ferry", "Stena Line")).toBeNull();
    expect(big.cancelled()).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: "tooLarge" }));
  });

  it("asks nobody while the admin switch is off", async () => {
    settings.operatorLogosOpenDataEnabled = false;
    use(happy());
    expect(await resolveOperatorMark("ferry", "Stena Line")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a stale entry is served at once and a failed refresh keeps it, stale", async () => {
    use(happy());
    await resolveOperatorMark("ferry", "Stena Line");
    const key = operatorMarkKey("Stena Line");
    const metaFile = `${operatorMarkCacheDir()}/${key}.meta.json`;
    const meta = JSON.parse(await fs.readFile(metaFile, "utf-8")) as {
      fetchedAt: number;
      lastAttemptAt: number;
    };
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await fs.writeFile(metaFile, JSON.stringify({ ...meta, fetchedAt: old, lastAttemptAt: old }));
    __resetOperatorMarkCachesForTests();
    use(() => json({}, 503));
    expect((await resolveOperatorMark("ferry", "Stena Line"))?.credit?.qid).toBe("Q833903");
    let after = { ...meta, lastAttemptAt: old };
    for (let i = 0; i < 40 && !(after.lastAttemptAt > old); i++) {
      await new Promise((r) => setTimeout(r, 50));
      after = JSON.parse(await fs.readFile(metaFile, "utf-8")) as {
        fetchedAt: number;
        lastAttemptAt: number;
      };
    }
    expect(after.fetchedAt).toBe(old);
    expect(after.lastAttemptAt).toBeGreaterThan(old);
  });

  it("a wrong-shaped Wikidata answer is a typed miss, not a thrown error", async () => {
    for (const body of [null, { search: [null] }, { search: "nope" }]) {
      __resetOperatorMarkCachesForTests();
      jest.clearAllMocks();
      use((url) => (url.includes("wbsearchentities") ? json(body) : happy()(url)));
      await expect(resolveOperatorMark("ferry", "Stena Line")).resolves.toBeNull();
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: "malformed" }));
    }
    for (const route of [
      (url: string) => (url.includes("wbgetentities") ? json(null) : happy()(url)),
      (url: string) => (url.includes("commons.wikimedia.org") ? json(null) : happy()(url)),
      (url: string) =>
        url.includes("wbgetentities") ? json({ entities: { Q833903: null } }) : happy()(url),
    ]) {
      __resetOperatorMarkCachesForTests();
      use(route);
      await expect(resolveOperatorMark("ferry", "Stena Line")).resolves.toBeNull();
    }
  });

  it("a stale entry whose refresh gets a wrong-shaped answer stays served, backed off", async () => {
    use(happy());
    await resolveOperatorMark("ferry", "Stena Line");
    const key = operatorMarkKey("Stena Line");
    const metaFile = `${operatorMarkCacheDir()}/${key}.meta.json`;
    const meta = JSON.parse(await fs.readFile(metaFile, "utf-8")) as {
      fetchedAt: number;
      lastAttemptAt: number;
    };
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await fs.writeFile(metaFile, JSON.stringify({ ...meta, fetchedAt: old, lastAttemptAt: old }));
    __resetOperatorMarkCachesForTests();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      use((url) => (url.includes("wbsearchentities") ? json({ search: [null] }) : happy()(url)));
      expect((await resolveOperatorMark("ferry", "Stena Line"))?.credit?.qid).toBe("Q833903");
      let after: { fetchedAt: number; lastAttemptAt: number } = { ...meta, lastAttemptAt: old };
      for (let i = 0; i < 40 && !(after.lastAttemptAt > old); i++) {
        await new Promise((r) => setTimeout(r, 50));
        after = JSON.parse(await fs.readFile(metaFile, "utf-8")) as {
          fetchedAt: number;
          lastAttemptAt: number;
        };
      }
      expect(after.fetchedAt).toBe(old);
      expect(after.lastAttemptAt).toBeGreaterThan(old);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("wikidata helpers", () => {
  it("never reads a deprecated statement", () => {
    expect(
      bestStringClaim(
        { P154: [{ rank: "deprecated", mainsnak: { datavalue: { value: "old.svg" } } }] },
        "P154"
      )
    ).toBeNull();
  });

  it("reduces Commons' HTML author to plain text", () => {
    expect(plainText('<span><a href="//x">Jane &amp; Co</a></span>')).toBe("Jane & Co");
    expect(plainText("")).toBeNull();
  });

  it("reads crafted Commons HTML in linear time (security review)", () => {
    // Commons' Artist / licence fields are third-party HTML. Each of these
    // made the old tag regexes backtrack polynomially.
    const crafted = [
      '<a style="display:none">x'.repeat(40_000), // hidden opener, no closer
      '<a style="'.repeat(60_000), // attribute quote never closed
      "<".repeat(300_000), // tags that never end
      '<b style="display: none">'.repeat(20_000) + "</c>".repeat(20_000),
      Array.from({ length: 20_000 }, (_, i) => `<t${i} style="display:none">`).join(""),
    ];
    for (const html of crafted) {
      const started = performance.now();
      plainText(html);
      expect(performance.now() - started).toBeLessThan(150);
    }
  });

  it("still reads nested and normal markup after the rewrite", () => {
    expect(
      plainText('<span style="display:none"><span>a</span>b</span>Jane<br/> &amp; <i>Co</i>')
    ).toBe("Jane & Co");
    expect(plainText('A<span style="display:none">x')).toBe("A x");
    expect(plainText("Jane <unfinished")).toBe("Jane");
  });

  it("leaves out the text Commons hides, so an author is credited once", () => {
    // Commons' own Artist value for File:Flixbus_201x_logo.svg (2026-10-21):
    // the card read "Unknown author Unknown author".
    expect(plainText('Unknown author<span style="display: none;">Unknown author</span>')).toBe(
      "Unknown author"
    );
    expect(
      plainText(
        '<span style="DISPLAY:none">x</span><a href="//y">Jane</a><div style="color:red">!</div>'
      )
    ).toBe("Jane !");
  });
});
