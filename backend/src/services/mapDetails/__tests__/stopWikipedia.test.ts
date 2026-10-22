import {
  __clearStopWikipediaCache,
  firstSentences,
  matchStopTitle,
  STOP_LOOKUP_DEADLINE_MS,
  StopLookupDeadlineError,
  stopWikipediaSummary,
} from "../stopWikipedia";
import { OpenDataUnavailableError } from "../../openData/http";

/**
 * A station's Wikipedia opening (rich map details, 2026-10-21): found by
 * place, confirmed by name and kind — an article next door that only shares
 * the city's name is not the station — and an outage is said, not cached.
 */

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function summary(title: string, extract: string) {
  return {
    type: "standard",
    title,
    extract,
    thumbnail: { source: "https://upload.wikimedia.org/x.jpg" },
    content_urls: { desktop: { page: `https://de.wikipedia.org/wiki/${title}` } },
  };
}

describe("matching a station to an article", () => {
  it("takes the station article that carries the name and names a station", () => {
    expect(
      matchStopTitle("rail", "Hamburg Hbf", ["Hamburger Kunsthalle", "Hamburg Hauptbahnhof"])
    ).toBe("Hamburg Hauptbahnhof");
  });

  it("prefers the station's own article to one about an event there", () => {
    // Wikipedia's real geosearch around Hamburg Hbf, 2026-10-21, in its order.
    const near = [
      "Steintorfriedhöfe",
      "Messerangriff am Hamburger Hauptbahnhof 2025",
      "Hamburg Hauptbahnhof",
    ];
    expect(matchStopTitle("rail", "Hamburg Hbf", near)).toBe("Hamburg Hauptbahnhof");
    expect(matchStopTitle("rail", "Hamburg Hbf", near.slice(0, 2))).toBeNull();
  });

  it("refuses a neighbour that only shares the city's name", () => {
    expect(matchStopTitle("rail", "Hamburg Hbf", ["Hamburg Museum", "Hamburger Kunsthalle"])).toBe(
      null
    );
  });

  it("refuses an article missing a distinctive word of the name", () => {
    expect(matchStopTitle("rail", "Berlin Friedrichstraße", ["Berlin Hauptbahnhof"])).toBeNull();
  });

  it("reads 'Kiel' in 'Kieler Hafen' for a ferry port", () => {
    expect(matchStopTitle("ferry", "Kiel", ["Kieler Hafen"])).toBe("Kieler Hafen");
  });

  it("never takes the city's own article for its port", () => {
    expect(matchStopTitle("ferry", "Kiel Hafen", ["Kiel"])).toBeNull();
  });

  it("abstains for a name of generic words only", () => {
    expect(matchStopTitle("bus", "ZOB", ["Zentraler Omnibusbahnhof Hamburg"])).toBeNull();
  });
});

describe("first sentences", () => {
  it("keeps the first two sentences", () => {
    expect(firstSentences("Eins ist hier. Zwei folgt. Drei bleibt weg.")).toBe(
      "Eins ist hier. Zwei folgt."
    );
  });

  it("does not split inside a sentence at an abbreviation before a number", () => {
    // Wikipedia's real opening of "Hamburg Hauptbahnhof", 2026-10-21: the old
    // splitter skipped the second sentence and kept its last fragment, " lt.".
    const extract =
      "Der Hamburger Hauptbahnhof ist einer der wichtigsten Eisenbahnknoten Deutschlands. " +
      "Mit täglich ca. 550.000 Reisenden lt. Deutscher Bahn ist er der meistfrequentierte. " +
      "Ein dritter Satz.";
    expect(firstSentences(extract)).toBe(
      "Der Hamburger Hauptbahnhof ist einer der wichtigsten Eisenbahnknoten Deutschlands. " +
        "Mit täglich ca. 550.000 Reisenden lt. Deutscher Bahn ist er der meistfrequentierte."
    );
  });

  it("caps a run-on extract", () => {
    expect(firstSentences("a".repeat(1000)).length).toBeLessThanOrEqual(360);
  });
});

describe("stopWikipediaSummary", () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => __clearStopWikipediaCache());
  afterAll(() => {
    global.fetch = realFetch;
  });
  function use(route: (url: string) => Response): void {
    fetchMock = jest.fn(async (input: string | URL) => route(String(input)));
    global.fetch = fetchMock as unknown as typeof fetch;
  }

  it("returns the station's opening, two sentences", async () => {
    use((url) => {
      if (url.includes("geosearch"))
        return json({ query: { geosearch: [{ title: "Hamburg Hauptbahnhof", dist: 40 }] } });
      return json(summary("Hamburg Hauptbahnhof", "Eins. Zwei. Drei."));
    });
    const s = await stopWikipediaSummary("rail", "Hamburg Hbf", 53.553, 10.007, "de");
    expect(s).toMatchObject({ title: "Hamburg Hauptbahnhof", extract: "Eins. Zwei.", lang: "de" });
    // Asked by place, never by the name alone.
    expect(String(fetchMock.mock.calls[0][0])).toContain("gscoord=53.55300%7C10.00700");
  });

  it("answers null and remembers it when no article is the station", async () => {
    use(() => json({ query: { geosearch: [{ title: "Hamburg Museum" }] } }));
    expect(await stopWikipediaSummary("rail", "Hamburg Hbf", 53.5, 10, "de")).toBeNull();
    const calls = fetchMock.mock.calls.length;
    expect(await stopWikipediaSummary("rail", "Hamburg Hbf", 53.5, 10, "de")).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("throws on an outage and does not cache it", async () => {
    use(() => json({}, 503));
    await expect(stopWikipediaSummary("rail", "Hamburg Hbf", 53.5, 10, "de")).rejects.toThrow(
      OpenDataUnavailableError
    );
    use((url) =>
      url.includes("geosearch")
        ? json({ query: { geosearch: [{ title: "Hamburg Hauptbahnhof" }] } })
        : json(summary("Hamburg Hauptbahnhof", "Eins."))
    );
    expect(await stopWikipediaSummary("rail", "Hamburg Hbf", 53.5, 10, "de")).not.toBeNull();
  });

  it("treats a Wikipedia API error answered with 200 as an outage, not a miss", async () => {
    use(() => json({ error: { code: "internal_api_error", info: "boom" } }));
    await expect(stopWikipediaSummary("ferry", "Kiel", 54.3, 10.1, "en")).rejects.toThrow(
      OpenDataUnavailableError
    );
  });

  /** Every request answers after `delayMs`, unless its own timeout aborts it first. */
  function useSlow(delayMs: number, route: (url: string) => Response): void {
    fetchMock = jest.fn(
      (input: string | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(route(String(input))), delayMs);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(init.signal?.reason);
          });
        })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  }
  // DE has no station article nearby; EN has: geosearch DE, geosearch EN, summary EN.
  const deMissEnHit = (url: string): Response =>
    url.includes("de.wikipedia")
      ? json({ query: { geosearch: [{ title: "Hamburg Museum" }] } })
      : url.includes("geosearch")
        ? json({ query: { geosearch: [{ title: "Hamburg Hauptbahnhof" }] } })
        : json(summary("Hamburg Hauptbahnhof", "Eins."));

  it("fits the whole lookup inside the web client's 10 s request timeout", () => {
    // frontend/src/lib/api/client.ts — API_TIMEOUTS.DEFAULT; the route's own DB
    // reads and the network need the rest.
    expect(STOP_LOOKUP_DEADLINE_MS).toBeLessThanOrEqual(8_000);
  });

  it("stops at the overall deadline and says so, instead of outliving the client", async () => {
    useSlow(150, deMissEnHit);
    const started = Date.now();
    await expect(
      stopWikipediaSummary("rail", "Hamburg Hbf", 53.5, 10, "de", { deadlineMs: 350 })
    ).rejects.toThrow(StopLookupDeadlineError);
    expect(Date.now() - started).toBeLessThan(450);
    // A deadline is an outage, not a miss: the next view asks again.
    useSlow(10, deMissEnHit);
    expect(await stopWikipediaSummary("rail", "Hamburg Hbf", 53.5, 10, "de")).not.toBeNull();
  });

  it("answers a slow but successful lookup that finishes within the deadline", async () => {
    useSlow(100, deMissEnHit);
    expect(
      await stopWikipediaSummary("rail", "Hamburg Hbf", 53.5, 10, "de", { deadlineMs: 1_000 })
    ).toMatchObject({ title: "Hamburg Hauptbahnhof", lang: "en" });
  });

  it("treats a malformed geosearch answer as an outage", async () => {
    use(() => json({ query: { geosearch: "nope" } }));
    await expect(stopWikipediaSummary("ferry", "Kiel", 54.3, 10.1, "en")).rejects.toThrow(
      OpenDataUnavailableError
    );
  });
});
