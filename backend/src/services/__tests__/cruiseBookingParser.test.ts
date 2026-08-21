import http from "http";
import type { AddressInfo } from "net";
import { CruiseBookingParser, CRUISE_SYSTEM_PROMPT } from "../cruiseBookingParser";

// Spin up a tiny stand-in for the Ollama HTTP API so the parser can be
// exercised end-to-end (request body → response normalization) without
// touching a real LLM.

interface MockOllamaServer {
  url: string;
  close(): Promise<void>;
  setResponse(body: object): void;
  setTagsResponse(body: object): void;
}

async function startMockOllama(): Promise<MockOllamaServer> {
  let nextResponse: object = { response: "[]" };
  let tagsResponse: object = { models: [{ name: "gemma3:12b" }] };
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/tags") {
      res.end(JSON.stringify(tagsResponse));
      return;
    }
    if (req.url === "/api/generate") {
      // Drain body before responding so the parser's stream doesn't error.
      req.on("data", () => {});
      req.on("end", () => {
        res.end(JSON.stringify(nextResponse));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
    setResponse(body: object) {
      nextResponse = body;
    },
    setTagsResponse(body: object) {
      tagsResponse = body;
    },
  };
}

describe("CruiseBookingParser", () => {
  let mock: MockOllamaServer;
  let parser: CruiseBookingParser;

  beforeAll(async () => {
    mock = await startMockOllama();
    parser = new CruiseBookingParser({ url: mock.url, model: "gemma3:12b" });
  });

  afterAll(async () => {
    await mock.close();
  });

  it("checkAvailability returns true when /api/tags responds with models", async () => {
    expect(await parser.checkAvailability()).toBe(true);
  });

  it("parses a TUI Mein Schiff cruise with stops + cabin info", async () => {
    mock.setResponse({
      response: JSON.stringify([
        {
          shipName: "Mein Schiff 4",
          cruiseLine: "TUI Cruises",
          startDate: "2025-12-19",
          endDate: "2025-12-26",
          cabinNumber: "8123",
          cabinType: "balcony",
          deck: 8,
          bookingReference: "ABCD12",
          price: 2499.0,
          currency: "EUR",
          stops: [
            { dayNumber: 1, isAtSea: false, portName: "Hamburg", departureTime: "2025-12-19T18:00" },
            { dayNumber: 2, isAtSea: true },
            { dayNumber: 3, isAtSea: false, portName: "Bergen", arrivalTime: "2025-12-21T08:00", departureTime: "2025-12-21T17:00" },
            { dayNumber: 4, isAtSea: false, portName: "Hamburg", arrivalTime: "2025-12-26T08:00" },
          ],
        },
      ]),
    });

    const result = await parser.parseText("Mein Schiff 4 Buchungsbestätigung …");
    expect(result).toHaveLength(1);
    const cruise = result[0];
    expect(cruise.shipName).toBe("Mein Schiff 4");
    expect(cruise.cabinType).toBe("balcony");
    expect(cruise.deck).toBe(8);
    expect(cruise.price).toBe(2499);
    expect(cruise.currency).toBe("EUR");
    expect(cruise.stops).toHaveLength(4);
    expect(cruise.stops[0].portName).toBe("Hamburg");
    expect(cruise.stops[1].isAtSea).toBe(true);
    expect(cruise.stops[1].portName).toBeUndefined();
    // Day numbers are re-sequenced 1..N regardless of LLM output.
    expect(cruise.stops.map((s) => s.dayNumber)).toEqual([1, 2, 3, 4]);
  });

  it("extracts per-stop dates (incl. German DD.MM.YYYY) and routeName (#132/#133)", async () => {
    mock.setResponse({
      response: JSON.stringify([
        {
          shipName: "Mein Schiff 1",
          routeName: "Kanaren mit Marokko",
          startDate: "2027-10-08",
          endDate: "2027-10-10",
          stops: [
            { dayNumber: 1, isAtSea: false, portName: "Bayonne", date: "2027-10-08" },
            { dayNumber: 2, isAtSea: true, date: "2027-10-09" },
            // German format leaking through must still normalize to ISO.
            { dayNumber: 3, isAtSea: false, portName: "Boston", date: "10.10.2027" },
          ],
        },
      ]),
    });

    const [cruise] = await parser.parseText("…");
    expect(cruise.routeName).toBe("Kanaren mit Marokko");
    expect(cruise.stops.map((s) => s.date)).toEqual(["2027-10-08", "2027-10-09", "2027-10-10"]);
  });

  it("strips invalid cabinType / currency rather than passing junk through", async () => {
    mock.setResponse({
      response: JSON.stringify([
        {
          shipName: "Mein Schiff 1",
          startDate: "2026-01-15",
          endDate: "2026-01-22",
          cabinType: "deluxe-suite",
          currency: "BTC",
          stops: [],
        },
      ]),
    });

    const [cruise] = await parser.parseText("…");
    expect(cruise.cabinType).toBeUndefined();
    expect(cruise.currency).toBeUndefined();
    expect(cruise.missing).toContain("stops");
  });

  it("populates `missing` when critical fields are absent", async () => {
    mock.setResponse({ response: JSON.stringify([{ stops: [] }]) });
    const [cruise] = await parser.parseText("…");
    expect(cruise.missing).toEqual(expect.arrayContaining(["shipName", "startDate", "endDate", "stops"]));
  });

  it("strips <think> blocks and ```json fences before extracting JSON", async () => {
    mock.setResponse({
      response:
        "<think>Let me think about this…</think>\n```json\n[{\"shipName\":\"Test Ship\",\"stops\":[]}]\n```",
    });
    const [cruise] = await parser.parseText("…");
    expect(cruise.shipName).toBe("Test Ship");
  });

  it("throws when Ollama returns a payload that doesn't unwrap to a cruise array", async () => {
    mock.setResponse({ response: "{\"oops\":true}" });
    await expect(parser.parseText("…")).rejects.toThrow(/cruise array/);
  });

  it("unwraps a top-level object with a 'cruises' wrapper key (format:json mode)", async () => {
    mock.setResponse({
      response: JSON.stringify({
        cruises: [{ shipName: "Mein Schiff 5", startDate: "2026-05-01", endDate: "2026-05-08", stops: [] }],
      }),
    });
    const [cruise] = await parser.parseText("…");
    expect(cruise.shipName).toBe("Mein Schiff 5");
  });

  it("treats a single-cruise object as a length-1 array", async () => {
    mock.setResponse({
      response: JSON.stringify({ shipName: "Solo Ship", startDate: "2026-07-01", endDate: "2026-07-08", stops: [] }),
    });
    const [cruise] = await parser.parseText("…");
    expect(cruise.shipName).toBe("Solo Ship");
  });

  it("re-sequences dayNumber gaps and out-of-order stops to monotone 1..N", async () => {
    mock.setResponse({
      response: JSON.stringify([
        {
          shipName: "Mein Schiff 6",
          startDate: "2026-08-01",
          endDate: "2026-08-08",
          stops: [
            { dayNumber: 7, isAtSea: false, portName: "Stockholm" },
            { dayNumber: 1, isAtSea: false, portName: "Hamburg" },
            { dayNumber: 4, isAtSea: true },
            { dayNumber: 12, isAtSea: false, portName: "Tallinn" },
          ],
        },
      ]),
    });
    const [cruise] = await parser.parseText("…");
    expect(cruise.stops.map((s) => s.dayNumber)).toEqual([1, 2, 3, 4]);
    expect(cruise.stops.map((s) => s.portName)).toEqual([
      "Hamburg",
      undefined,
      "Stockholm",
      "Tallinn",
    ]);
  });

  it("clears portName on at-sea stops even if the LLM hallucinated one", async () => {
    mock.setResponse({
      response: JSON.stringify([
        {
          shipName: "Mein Schiff 7",
          startDate: "2026-09-01",
          endDate: "2026-09-08",
          stops: [
            { dayNumber: 1, isAtSea: false, portName: "Hamburg" },
            // LLM occasionally invents a port name on an at-sea day —
            // normalizer must drop it so Zod doesn't reject the upload.
            { dayNumber: 2, isAtSea: true, portName: "Mid-Ocean Resort" },
          ],
        },
      ]),
    });
    const [cruise] = await parser.parseText("…");
    expect(cruise.stops[1].isAtSea).toBe(true);
    expect(cruise.stops[1].portName).toBeUndefined();
  });

  it("rejects negative or zero dayNumber values and replaces them with positional fallback", async () => {
    mock.setResponse({
      response: JSON.stringify([
        {
          shipName: "Mein Schiff 8",
          startDate: "2026-10-01",
          endDate: "2026-10-04",
          stops: [
            { dayNumber: 0, isAtSea: false, portName: "Hamburg" },
            { dayNumber: -3, isAtSea: true },
            { dayNumber: 2, isAtSea: false, portName: "Bergen" },
          ],
        },
      ]),
    });
    const [cruise] = await parser.parseText("…");
    expect(cruise.stops.map((s) => s.dayNumber)).toEqual([1, 2, 3]);
    // After re-sequencing the original positional fallback (index+1) sorts
    // the stops as: index0 → 1 (Hamburg, fallback), index1 → 2 (sea, fallback),
    // index2 → 2 (Bergen, real). The stable-sort keeps Bergen after the
    // sea-day fallback when both have key=2; final sequence is 1,2,3.
    expect(cruise.stops[0].portName).toBe("Hamburg");
  });

  it("drops invalid deck values (non-positive, NaN) without throwing", async () => {
    mock.setResponse({
      response: JSON.stringify([
        {
          shipName: "Mein Schiff 9",
          startDate: "2026-11-01",
          endDate: "2026-11-08",
          deck: -3,
          stops: [],
        },
      ]),
    });
    const [cruise] = await parser.parseText("…");
    expect(cruise.deck).toBeUndefined();
  });
});

/**
 * Extraction truthfulness (the HX Antarctica booking, 2026-08-21): the parser
 * offered flight "LH2080" although the document contains NO flight numbers —
 * the number had bled through from the prompt's own format example. And the
 * price came back as one guest's pre-discount fare instead of the booking
 * total.
 */
describe("CruiseBookingParser — extraction truthfulness", () => {
  let mock: MockOllamaServer;
  let parser: CruiseBookingParser;

  beforeAll(async () => {
    mock = await startMockOllama();
    parser = new CruiseBookingParser({ url: mock.url, model: "gemma3:12b" });
  });

  afterAll(async () => {
    await mock.close();
  });

  const cruiseWithFlight = (flightNumber: string) => ({
    cruises: [
      {
        shipName: "MS Roald Amundsen",
        startDate: "2027-02-19",
        endDate: "2027-03-05",
        flights: [
          {
            flightNumber,
            direction: "outbound",
            date: "2027-02-17",
            departureAirport: "Munich International Airport",
            arrivalAirport: "Pistarini Buenos Aires Airport",
          },
        ],
      },
    ],
  });

  it("strips a flight number that does not appear in the source text", async () => {
    mock.setResponse({ response: JSON.stringify(cruiseWithFlight("LH2080")) });
    const result = await parser.parseText(
      "FLUG VOR DER SEEREISE: ABFLUG 17. FEBRUAR 27 Munich International Airport - Pistarini Buenos Aires Airport"
    );
    expect(result[0].flights).toHaveLength(1);
    expect(result[0].flights[0].flightNumber).toBeUndefined();
    expect(result[0].flights[0].arrivalAirport).toBe("Pistarini Buenos Aires Airport");
  });

  it("keeps a flight number that appears verbatim, even spelled with a space", async () => {
    mock.setResponse({ response: JSON.stringify(cruiseWithFlight("LH2080")) });
    const result = await parser.parseText(
      "Ihr Flug LH 2080 am 17.02.2027 von Muenchen nach Buenos Aires"
    );
    expect(result[0].flights[0].flightNumber).toBe("LH2080");
  });

  it("drops the flight entirely when nothing verifiable remains", async () => {
    mock.setResponse({
      response: JSON.stringify({
        cruises: [
          {
            shipName: "MS Roald Amundsen",
            flights: [{ flightNumber: "LH2080" }],
          },
        ],
      }),
    });
    const result = await parser.parseText("Beleg ohne Flugnummern");
    expect(result[0].flights).toHaveLength(0);
  });

  describe("system prompt contract", () => {
    it("no longer uses a realistic flight number as its format example", () => {
      expect(CRUISE_SYSTEM_PROMPT).not.toContain("LH 2080");
      expect(CRUISE_SYSTEM_PROMPT).not.toContain("LH2080");
    });

    it("demands verbatim flight numbers only", () => {
      expect(CRUISE_SYSTEM_PROMPT).toMatch(/flightNumber[\s\S]{0,200}verbatim/i);
    });

    it("asks for the grand total of the whole booking, all guests, after discounts", () => {
      expect(CRUISE_SYSTEM_PROMPT).toMatch(/price[\s\S]{0,400}(all guests|whole booking)/i);
      expect(CRUISE_SYSTEM_PROMPT).toMatch(/after discounts/i);
      expect(CRUISE_SYSTEM_PROMPT).toMatch(/Insgesamt|Gesamtpreis/);
    });
  });
});

