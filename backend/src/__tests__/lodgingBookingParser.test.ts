import fs from "fs";
import http from "http";
import path from "path";
import type { AddressInfo } from "net";
import { extractEmailFromFile } from "../services/emailExtractor";
import { parseLodgingBookingText } from "../services/lodging/lodgingBookingParser";
import { bookingsToCandidates } from "../services/lodging/lodgingCandidates";
import { getAdminParserSettings } from "../services/parserSettings";
import type { ParsedLodgingBooking } from "../services/lodging/bookingComTemplate";

jest.mock("../services/parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({ ollamaUrl: null, ollamaModel: null })),
}));

const mockGetAdminParserSettings = getAdminParserSettings as jest.MockedFunction<
  typeof getAdminParserSettings
>;

// The owner's REAL booking confirmations. Gitignored, present only on his
// machine — the suite skips itself everywhere else so CI stays green. We
// assert on extracted structure only; no sample content is ever printed.
const SAMPLE_DIR = path.resolve(__dirname, "../../..", "test-samples", "Hotel Buchungen");
const hasSamples = fs.existsSync(SAMPLE_DIR);
const describeSamples = hasSamples ? describe : describe.skip;

const BOOKING_COM_TEXT = [
  "<https://booking.com> \t Bestätigungsnummer: 1234567890",
  "Anreise\t Montag, 5. Januar 2026 (ab 15:00)",
  "Abreise\t Mittwoch, 7. Januar 2026 (bis 11:00)",
  "Ihre Buchung\t 2 Nächte, Superior Zimmer",
  "Lage\t Musterweg 1, 12345 Musterstadt, Deutschland",
  "Gesamtpreis",
  "€ 250,00",
].join("\n");

/** A minimal local stand-in for Ollama's `/api/tags` + `/api/generate`. Every
 *  "LLM" in this suite is one of these — no test ever dials a real model.
 *  `hitCount()` lets precedence tests prove a lower-priority endpoint was
 *  never even contacted, not just that the final result happened to differ. */
function createMockOllamaServer(handler: http.RequestListener): Promise<{
  url: string;
  close: () => Promise<void>;
  hitCount: () => number;
}> {
  return new Promise((resolve, reject) => {
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits += 1;
      handler(req, res);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((res) => server.close(() => res())),
        hitCount: () => hits,
      });
    });
  });
}

function respondJson(res: http.ServerResponse, body: unknown): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const HEALTHY_TAGS_RESPONSE = { models: [{ name: "mock" }] };

describe("parseLodgingBookingText", () => {
  beforeEach(() => {
    mockGetAdminParserSettings.mockClear();
    mockGetAdminParserSettings.mockResolvedValue({ ollamaUrl: null, ollamaModel: null });
  });

  it("uses the template for a Booking.com confirmation and never calls the LLM", async () => {
    const result = await parseLodgingBookingText(
      `Ihre Buchung ist bestätigt: Musterhotel\n\n${BOOKING_COM_TEXT}`,
      // A deliberately unreachable Ollama: if the template path is taken, this
      // is never dialled, so the call must still succeed fast.
      { url: "http://127.0.0.1:1", model: "nonexistent" },
    );
    expect(result.parserUsed).toBe("template");
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0].hotelName).toBe("Musterhotel");
    expect(result.bookings[0].totalPrice).toBeCloseTo(250, 2);
    // Settings resolution is part of the LLM path — proving it was never
    // reached proves the LLM itself was never dialled either.
    expect(mockGetAdminParserSettings).not.toHaveBeenCalled();
  });

  it("never throws when the LLM is unreachable — it reports parserUsed 'none'", async () => {
    const result = await parseLodgingBookingText("Buchungsnummer: 260308233983\nAnreise\nAbreise", {
      url: "http://127.0.0.1:1",
      model: "nonexistent",
    });
    expect(result.parserUsed).toBe("none");
    expect(result.bookings).toEqual([]);
    expect(result.ollamaAvailable).toBe(false);
    expect(typeof result.fallbackReason).toBe("string");
  });

  describe("failure matrix — the LLM must never block or throw", () => {
    it("reports 'none' when the generate call returns malformed JSON", async () => {
      const server = await createMockOllamaServer((req, res) => {
        if (req.url === "/api/tags") return respondJson(res, HEALTHY_TAGS_RESPONSE);
        // Ollama is reachable, but the model produced garbage — not JSON at all.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("this is not json{{{");
      });
      try {
        const result = await parseLodgingBookingText("Buchungsnummer: 1\nAnreise\nAbreise", {
          url: server.url,
          model: "mock",
        });
        expect(result.parserUsed).toBe("none");
        expect(result.bookings).toEqual([]);
        expect(result.ollamaAvailable).toBe(true);
        expect(typeof result.fallbackReason).toBe("string");
      } finally {
        await server.close();
      }
    });

    it("bounds a hanging generate call instead of waiting forever", async () => {
      process.env.LODGING_OLLAMA_TIMEOUT_MS = "200";
      const server = await createMockOllamaServer((req, res) => {
        if (req.url === "/api/tags") return respondJson(res, HEALTHY_TAGS_RESPONSE);
        // Deliberately never respond — the client-side timeout must fire.
      });
      try {
        const start = Date.now();
        const result = await parseLodgingBookingText("Buchungsnummer: 1\nAnreise\nAbreise", {
          url: server.url,
          model: "mock",
        });
        const elapsedMs = Date.now() - start;
        expect(result.parserUsed).toBe("none");
        expect(result.bookings).toEqual([]);
        expect(typeof result.fallbackReason).toBe("string");
        // Bounded: well under the production default (120s), close to the
        // overridden 200ms timeout.
        expect(elapsedMs).toBeLessThan(5_000);
      } finally {
        delete process.env.LODGING_OLLAMA_TIMEOUT_MS;
        await server.close();
      }
    });

    it("reports 'none' when nothing is configured and the default endpoint is unreachable (disabled)", async () => {
      const originalUrl = process.env.OLLAMA_URL;
      const originalModel = process.env.OLLAMA_MODEL;
      // No options, admin settings resolve to null (default mock), and the env
      // fallback points at a guaranteed-refused port — this is what "the LLM
      // was never configured / is effectively switched off" looks like.
      process.env.OLLAMA_URL = "http://127.0.0.1:1";
      process.env.OLLAMA_MODEL = "nonexistent";
      try {
        const result = await parseLodgingBookingText("Buchungsnummer: 1\nAnreise\nAbreise");
        expect(result.parserUsed).toBe("none");
        expect(result.ollamaAvailable).toBe(false);
        expect(typeof result.fallbackReason).toBe("string");
      } finally {
        if (originalUrl === undefined) delete process.env.OLLAMA_URL;
        else process.env.OLLAMA_URL = originalUrl;
        if (originalModel === undefined) delete process.env.OLLAMA_MODEL;
        else process.env.OLLAMA_MODEL = originalModel;
      }
    });
  });

  describe("settings resolution order (options > admin_settings > env > default)", () => {
    it("prefers explicit options over a healthy admin-configured endpoint", async () => {
      const healthyAdmin = await createMockOllamaServer((req, res) =>
        respondJson(res, HEALTHY_TAGS_RESPONSE),
      );
      mockGetAdminParserSettings.mockResolvedValue({
        ollamaUrl: healthyAdmin.url,
        ollamaModel: "admin-model",
      });
      try {
        // Explicit options point at a refused port — if they truly win, the
        // result must be "none", never "ollama" (which would mean the admin
        // endpoint was used instead).
        const result = await parseLodgingBookingText("Buchungsnummer: 1\nAnreise\nAbreise", {
          url: "http://127.0.0.1:1",
          model: "nonexistent",
        });
        expect(result.parserUsed).toBe("none");
        expect(result.ollamaAvailable).toBe(false);
        // The admin-configured endpoint must never even be contacted.
        expect(healthyAdmin.hitCount()).toBe(0);
      } finally {
        await healthyAdmin.close();
      }
    });

    it("prefers admin_settings over an unreachable env fallback", async () => {
      const originalUrl = process.env.OLLAMA_URL;
      const originalModel = process.env.OLLAMA_MODEL;
      process.env.OLLAMA_URL = "http://127.0.0.1:1";
      process.env.OLLAMA_MODEL = "nonexistent";
      const healthyAdmin = await createMockOllamaServer((req, res) => {
        if (req.url === "/api/tags") return respondJson(res, HEALTHY_TAGS_RESPONSE);
        respondJson(res, {
          response: JSON.stringify({
            bookings: [
              {
                hotelName: "Admin Endpoint Hotel",
                checkIn: "2026-05-01",
                checkOut: "2026-05-02",
                nights: 1,
              },
            ],
          }),
        });
      });
      mockGetAdminParserSettings.mockResolvedValue({
        ollamaUrl: healthyAdmin.url,
        ollamaModel: "admin-model",
      });
      try {
        const result = await parseLodgingBookingText("Buchungsnummer: 1\nAnreise\nAbreise");
        expect(result.parserUsed).toBe("ollama");
        expect(result.bookings[0]?.hotelName).toBe("Admin Endpoint Hotel");
      } finally {
        if (originalUrl === undefined) delete process.env.OLLAMA_URL;
        else process.env.OLLAMA_URL = originalUrl;
        if (originalModel === undefined) delete process.env.OLLAMA_MODEL;
        else process.env.OLLAMA_MODEL = originalModel;
        await healthyAdmin.close();
      }
    });

    it("falls back to the env var when admin_settings has nothing configured", async () => {
      const originalUrl = process.env.OLLAMA_URL;
      const originalModel = process.env.OLLAMA_MODEL;
      const healthyEnv = await createMockOllamaServer((req, res) => {
        if (req.url === "/api/tags") return respondJson(res, HEALTHY_TAGS_RESPONSE);
        respondJson(res, {
          response: JSON.stringify({
            bookings: [
              {
                hotelName: "Env Fallback Hotel",
                checkIn: "2026-05-01",
                checkOut: "2026-05-02",
                nights: 1,
              },
            ],
          }),
        });
      });
      process.env.OLLAMA_URL = healthyEnv.url;
      process.env.OLLAMA_MODEL = "env-model";
      mockGetAdminParserSettings.mockResolvedValue({ ollamaUrl: null, ollamaModel: null });
      try {
        const result = await parseLodgingBookingText("Buchungsnummer: 1\nAnreise\nAbreise");
        expect(result.parserUsed).toBe("ollama");
        expect(result.bookings[0]?.hotelName).toBe("Env Fallback Hotel");
      } finally {
        if (originalUrl === undefined) delete process.env.OLLAMA_URL;
        else process.env.OLLAMA_URL = originalUrl;
        if (originalModel === undefined) delete process.env.OLLAMA_MODEL;
        else process.env.OLLAMA_MODEL = originalModel;
        await healthyEnv.close();
      }
    });
  });

  it("falls through to the (mocked) LLM for an email no template recognises", async () => {
    const server = await createMockOllamaServer((req, res) => {
      if (req.url === "/api/tags") return respondJson(res, HEALTHY_TAGS_RESPONSE);
      respondJson(res, {
        response: JSON.stringify({
          bookings: [
            {
              hotelName: "Direct Hotel GmbH",
              checkIn: "2026-03-08",
              checkOut: "2026-03-09",
              nights: 1,
              roomCategory: "Doppelzimmer",
              city: "Herzogenaurach",
              totalPrice: 89,
              currency: "EUR",
              confirmationNumber: "260308233983",
            },
          ],
        }),
      });
    });
    try {
      const result = await parseLodgingBookingText("Buchungsnummer: 260308233983\nAnreise\nAbreise", {
        url: server.url,
        model: "mock",
      });
      expect(result.parserUsed).toBe("ollama");
      expect(result.ollamaAvailable).toBe(true);
      expect(result.bookings).toHaveLength(1);
      expect(result.bookings[0].hotelName).toBe("Direct Hotel GmbH");
      expect(result.bookings[0].parserTemplate).toBe("ollama-lodging");
    } finally {
      await server.close();
    }
  });

  it("keeps an AED price, which the four-currency era could not represent", async () => {
    // The owner's Armani Hotel Dubai confirmation, found 2026-08-13. The LLM
    // read it correctly — 11662 AED — but AED was not one of the four codes the
    // domain accepted, so `asCurrency` returned null and the amount was dropped
    // to keep `applyFxSnapshot` from reading it as €11,662 against a real cost
    // of roughly €2,900.
    //
    // Dropping it was the honest answer to a validation limit, not the goal.
    // With the ISO-4217 registry in place the limit is gone and the price
    // survives with its own unit; whether a RATE exists for it is a separate
    // question, answered further down the chain.
    const server = await createMockOllamaServer((req, res) => {
      if (req.url === "/api/tags") return respondJson(res, HEALTHY_TAGS_RESPONSE);
      respondJson(res, {
        response: JSON.stringify({
          bookings: [
            {
              hotelName: "Armani Hotel Dubai",
              checkIn: "2023-04-30",
              checkOut: "2023-05-03",
              nights: 3,
              totalPrice: 11662,
              currency: "AED",
              confirmationNumber: "711754296",
            },
          ],
        }),
      });
    });
    try {
      const result = await parseLodgingBookingText("Buchungsnummer: 711754296\nAnreise\nAbreise", {
        url: server.url,
        model: "mock",
      });
      const booking = result.bookings[0];
      expect(booking.hotelName).toBe("Armani Hotel Dubai");
      expect(booking.checkIn).toBe("2023-04-30");
      expect(booking.nights).toBe(3);
      expect(booking.totalPrice).toBe(11662);
      expect(booking.currency).toBe("AED");
      expect(booking.missing).not.toContain("totalPrice");
    } finally {
      await server.close();
    }
  });

  it("still drops a price whose currency is not a currency at all", async () => {
    // The guard that saved the AED booking above is still needed: an LLM that
    // emits "EURO", a bare symbol, or a stray word gives us a number with no
    // usable unit. A number whose unit was thrown away is not a price — losing
    // it is honest, keeping it silently multiplies the user's spend statistics.
    const server = await createMockOllamaServer((req, res) => {
      if (req.url === "/api/tags") return respondJson(res, HEALTHY_TAGS_RESPONSE);
      respondJson(res, {
        response: JSON.stringify({
          bookings: [
            {
              hotelName: "Hotel Ohne Einheit",
              checkIn: "2023-04-30",
              checkOut: "2023-05-03",
              nights: 3,
              totalPrice: 11662,
              currency: "EURO",
              confirmationNumber: "711754296",
            },
          ],
        }),
      });
    });
    try {
      const result = await parseLodgingBookingText("Buchungsnummer: 711754296\nAnreise\nAbreise", {
        url: server.url,
        model: "mock",
      });
      const booking = result.bookings[0];
      expect(booking.hotelName).toBe("Hotel Ohne Einheit");
      // Everything else survives — only the unusable amount is dropped.
      expect(booking.checkIn).toBe("2023-04-30");
      expect(booking.nights).toBe(3);
      expect(booking.totalPrice).toBeNull();
      expect(booking.currency).toBeNull();
      expect(booking.missing).toContain("totalPrice");
    } finally {
      await server.close();
    }
  });

  it("keeps a price whose currency the domain does support", async () => {
    const server = await createMockOllamaServer((req, res) => {
      if (req.url === "/api/tags") return respondJson(res, HEALTHY_TAGS_RESPONSE);
      respondJson(res, {
        response: JSON.stringify({
          bookings: [
            {
              hotelName: "Engimatt",
              checkIn: "2026-06-30",
              checkOut: "2026-07-01",
              totalPrice: 292.83,
              currency: "CHF",
              confirmationNumber: "5980532080",
            },
          ],
        }),
      });
    });
    try {
      const result = await parseLodgingBookingText("Buchungsnummer: 5980532080\nAnreise\nAbreise", {
        url: server.url,
        model: "mock",
      });
      expect(result.bookings[0].totalPrice).toBeCloseTo(292.83, 2);
      expect(result.bookings[0].currency).toBe("CHF");
      expect(result.bookings[0].missing).not.toContain("totalPrice");
    } finally {
      await server.close();
    }
  });

  describeSamples("real sample: direct hotel booking (LLM fully mocked)", () => {
    it("does not match the Booking.com template and reaches the mocked LLM fallback", async () => {
      const file = fs
        .readdirSync(SAMPLE_DIR)
        .find((f) => f.includes("Novina") && f.endsWith(".msg"));
      if (!file) throw new Error('No sample matching "Novina"');
      const buffer = fs.readFileSync(path.join(SAMPLE_DIR, file));
      const extracted = extractEmailFromFile(buffer, file);
      const text = `${extracted.subject}\n\n${extracted.text}`;

      const server = await createMockOllamaServer((req, res) => {
        if (req.url === "/api/tags") return respondJson(res, HEALTHY_TAGS_RESPONSE);
        respondJson(res, {
          response: JSON.stringify({
            bookings: [
              {
                hotelName: "Mocked Fallback Hotel",
                checkIn: "2026-03-08",
                checkOut: "2026-03-09",
                nights: 1,
              },
            ],
          }),
        });
      });
      try {
        const result = await parseLodgingBookingText(text, { url: server.url, model: "mock" });
        expect(result.parserUsed).toBe("ollama");
        expect(result.bookings).toHaveLength(1);
        expect(result.bookings[0].hotelName).toBe("Mocked Fallback Hotel");
      } finally {
        await server.close();
      }
    });
  });
});

describe("bookingsToCandidates", () => {
  const booking: ParsedLodgingBooking = {
    hotelName: "Musterhotel",
    checkIn: "2026-01-05",
    checkOut: "2026-01-07",
    nights: 2,
    roomCategory: "Superior Zimmer",
    address: "Musterweg 1",
    postcode: "12345",
    city: "Musterstadt",
    country: "Deutschland",
    totalPrice: 250,
    currency: "EUR",
    confirmationNumber: "1234567890",
    parserTemplate: "booking.com",
    parserConfidence: 95,
    missing: [],
  };

  it("maps a parsed booking to one candidate carrying both externalRefs", () => {
    const [candidate] = bookingsToCandidates([booking]);
    expect(candidate.sourceRowIndex).toBe(0);
    expect(candidate.lodging?.name).toBe("Musterhotel");
    expect(candidate.lodging?.type).toBe("hotel");
    expect(candidate.lodging?.city).toBe("Musterstadt");
    expect(candidate.lodging?.externalRef).toBeNull();
    expect(candidate.stay?.checkIn).toBe("2026-01-05");
    expect(candidate.stay?.checkOut).toBe("2026-01-07");
    expect(candidate.stay?.totalPrice).toBe(250);
    expect(candidate.stay?.currency).toBe("EUR");
    expect(candidate.stay?.externalRef).toBe("booking:1234567890");
    expect(candidate.stay?.bookingReference).toBe("1234567890");
  });

  it("omits the stay externalRef when there is no confirmation number", () => {
    const [candidate] = bookingsToCandidates([{ ...booking, confirmationNumber: null }]);
    expect(candidate.stay?.externalRef).toBeNull();
  });
});
