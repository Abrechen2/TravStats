import http from "http";
import type { AddressInfo } from "net";
import { parseBookingEmail } from "../../bookingParser";
import { parseCruiseBookingText } from "../../cruiseBookingParser";
import { parseLodgingBookingText } from "../../lodging/lodgingBookingParser";
import { clearAvailabilityCache } from "../config";
import { clearLlmAvailabilityCache, isLlmAvailable, recordLlmProbe } from "../llmAvailability";

/**
 * `ollamaAvailable` meant three different things, and the beta of 2026-09-19
 * said two of them about the same instance in the same minute: every flight
 * parse answered `true` (the flight parser read a fallback-chain entry that is
 * present on every default install) while every cruise parse answered `false`
 * (hardcoded on the template-first hit) — and `parserUsed` came back `"regex"`
 * throughout, with no model contacted at all.
 *
 * So the question this file asks is not "does the flag work" but "do the
 * domains agree, and does the answer follow the model rather than the config
 * file". The three states are the ones an operator can actually be in.
 */

jest.mock("../../parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({ ollamaUrl: null, ollamaModel: null })),
  // Template-first is the instance default. It is also the state that used to
  // lie the loudest, because cruise and lodging returned early from it with a
  // hardcoded `false`.
  getParserOrder: jest.fn(async () => "template_first"),
}));

const parserSettingsMock = jest.requireMock("../../parserSettings") as {
  getAdminParserSettings: jest.Mock;
};

/** Ollama's `/api/tags` as a healthy server answers it. */
const HEALTHY_TAGS = { models: [{ name: "mock" }] };

/** Nothing listens on the discard port, so a probe against it cannot pass. */
const UNREACHABLE_URL = "http://127.0.0.1:9";

interface MockOllama {
  url: string;
  close: () => Promise<void>;
  hits: () => number;
}

function startMockOllama(): Promise<MockOllama> {
  return new Promise((resolve, reject) => {
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      // `/api/tags` proves reachability; anything else is the generate call,
      // answered with the empty array so the flight chain finishes without
      // inventing a booking.
      res.end(JSON.stringify(req.url === "/api/tags" ? HEALTHY_TAGS : { response: "[]" }));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        hits: () => hits,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** A TUI confirmation the cruise template reads. Invented, as the fixtures are. */
const TUI_CONFIRMATION = [
  "TUI Cruises GmbH • Musterweg 1 • 20097 Hamburg",
  "Mein Schiff 9\tIhr Schiff:",
  "Ihre Reise: 2 Nächte - Testland - ab/bis Musterhafen",
  "Vorgang-Nr.: 1234567/2",
  "Mein Schiff 9",
  "Innenkabine (2er Belegung)",
  "Deck 8 - Welle - Kabine 8042",
  "01.05.2027 Musterhafen - 02.05.2027 Seetag - 03.05.2027 Musterhafen",
  "2 x Kreuzfahrtpreis 4.198,00 €\t2.099,00 €\t1-2",
].join("\n");

/** A booking.com confirmation the lodging template reads. */
const BOOKING_COM_TEXT = [
  // The subject line is part of the evidence — the template reads the hotel
  // name out of it.
  "Ihre Buchung ist bestätigt: Musterhotel",
  "",
  "<https://booking.com> \t Bestätigungsnummer: 1234567890",
  "Anreise\t Montag, 5. Januar 2026 (ab 15:00)",
  "Abreise\t Mittwoch, 7. Januar 2026 (bis 11:00)",
  "Ihre Buchung\t 2 Nächte, Superior Zimmer",
  "Lage\t Musterweg 1, 12345 Musterstadt, Deutschland",
  "Gesamtpreis",
  "€ 250,00",
].join("\n");

/** Text no flight reader recognises — the parser abstains, which is a result. */
const PLAIN_TEXT = "Guten Tag, anbei die Rechnung fuer Ihren letzten Einkauf.";

function configure(ollamaUrl: string | null, ollamaModel: string | null): void {
  parserSettingsMock.getAdminParserSettings.mockResolvedValue({ ollamaUrl, ollamaModel });
}

/**
 * Both caches, because they answer the same question at different depths: the
 * factory's 5-minute provider cache keys on the PROVIDER name rather than the
 * URL, so a leftover entry would answer for whichever endpoint a previous case
 * happened to use.
 */
function forgetProbes(): void {
  clearAvailabilityCache();
  clearLlmAvailabilityCache();
}

/** What each domain reports about the model for one and the same instance. */
async function askEveryDomain(): Promise<{ flight: boolean; cruise: boolean; lodging: boolean }> {
  const flight = await parseBookingEmail("Rechnung", PLAIN_TEXT);
  const cruise = await parseCruiseBookingText(TUI_CONFIRMATION);
  const lodging = await parseLodgingBookingText(BOOKING_COM_TEXT);
  // The documents are chosen so cruise and lodging hit their template — the
  // exact early return that used to hardcode `false`.
  expect(cruise.parserUsed).toBe("template");
  expect(lodging.parserUsed).toBe("template");
  return {
    flight: flight.ollamaAvailable,
    cruise: cruise.ollamaAvailable,
    lodging: lodging.ollamaAvailable,
  };
}

const originalUrl = process.env.OLLAMA_URL;
const originalModel = process.env.OLLAMA_MODEL;

beforeEach(() => {
  // The environment is the last fallback in every domain's resolution, so a
  // value left over from the developer's shell would silently configure a model.
  delete process.env.OLLAMA_URL;
  delete process.env.OLLAMA_MODEL;
  configure(null, null);
  forgetProbes();
});

afterAll(() => {
  if (originalUrl === undefined) delete process.env.OLLAMA_URL;
  else process.env.OLLAMA_URL = originalUrl;
  if (originalModel === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = originalModel;
  forgetProbes();
});

describe("llmAvailability — one definition of ollamaAvailable", () => {
  it("is true when the model is configured AND answers its probe", async () => {
    const server = await startMockOllama();
    try {
      configure(server.url, "mock");
      await expect(isLlmAvailable()).resolves.toBe(true);
    } finally {
      await server.close();
    }
  });

  it("is false when the model is configured but nothing answers", async () => {
    configure(UNREACHABLE_URL, "mock");
    await expect(isLlmAvailable()).resolves.toBe(false);
  });

  it("is false when no model is configured, without probing anything", async () => {
    const server = await startMockOllama();
    try {
      // A URL with no model is not a configured model: the endpoint exists but
      // nothing names what to ask it.
      configure(server.url, null);
      await expect(isLlmAvailable()).resolves.toBe(false);
      expect(server.hits()).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("probes once per minute, not once per parse", async () => {
    const server = await startMockOllama();
    try {
      configure(server.url, "mock");
      await expect(isLlmAvailable()).resolves.toBe(true);
      await expect(isLlmAvailable()).resolves.toBe(true);
      await expect(isLlmAvailable()).resolves.toBe(true);
      expect(server.hits()).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("takes a probe the caller already performed instead of repeating it", async () => {
    const server = await startMockOllama();
    try {
      configure(server.url, "mock");
      // This is what the cruise and lodging pipelines do with the check they
      // already run before calling the model.
      recordLlmProbe(server.url, false);
      await expect(isLlmAvailable()).resolves.toBe(false);
      expect(server.hits()).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("reports on the endpoint the caller overrides, not the configured one", async () => {
    const server = await startMockOllama();
    try {
      configure(server.url, "admin-model");
      await expect(isLlmAvailable({ url: UNREACHABLE_URL, model: "mock" })).resolves.toBe(false);
      // The admin's endpoint is not this parse's endpoint and must not be asked.
      expect(server.hits()).toBe(0);
    } finally {
      await server.close();
    }
  });
});

describe("llmAvailability — flights, cruises and lodging answer the same", () => {
  it("all say true when the model is configured and reachable", async () => {
    const server = await startMockOllama();
    try {
      configure(server.url, "mock");
      expect(await askEveryDomain()).toEqual({ flight: true, cruise: true, lodging: true });
    } finally {
      await server.close();
    }
  });

  it("all say false when the model is configured but unreachable", async () => {
    configure(UNREACHABLE_URL, "mock");
    expect(await askEveryDomain()).toEqual({ flight: false, cruise: false, lodging: false });
  });

  it("all say false when no model is configured", async () => {
    expect(await askEveryDomain()).toEqual({ flight: false, cruise: false, lodging: false });
  });
});
