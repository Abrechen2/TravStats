import http from "http";
import type { AddressInfo } from "net";
import { CruiseBookingParser } from "../cruiseBookingParser";

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
});
