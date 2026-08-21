import http from "http";
import { AddressInfo } from "net";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  OllamaTextParser,
  buildSystemPrompt,
} from "../services/parsers/text/ollamaTextParser";

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

/**
 * Booking-total price extraction (board item booking-total-price-not-parsed).
 *
 * The measured defect: a Lufthansa mail stating "Endpreis EUR 4,359.14" came
 * through the LLM parser with price empty on booking AND all four legs — the
 * prompt simply never asked for a price. These tests pin the new contract:
 * the model reports the booking TOTAL as a JSON number per leg, and the
 * mapper turns it into ParsedBooking.price/currency strings that the
 * existing review-modal → /flights/batch → booking-lift pipeline consumes.
 */
describe("Ollama text parser price extraction", () => {
  describe("buildSystemPrompt", () => {
    it("asks for the booking total as totalPrice and an ISO 4217 currency", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain("totalPrice");
      expect(prompt).toContain("currency");
      expect(prompt).toMatch(/ISO 4217/i);
    });

    it("demands a JSON number so localized strings like 4,359.14 cannot ambiguate", () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toMatch(/totalPrice[\s\S]{0,400}JSON number/i);
    });
  });

  describe("parseEmail mapping", () => {
    let server: http.Server;
    let baseUrl: string;
    let nextResponse: unknown[] = [];

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/api/generate") {
          let body = "";
          req.on("data", (c: string) => { body += c; });
          req.on("end", () => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ response: JSON.stringify(nextResponse) }));
          });
          return;
        }
        res.statusCode = 404;
        res.end();
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    });

    function leg(overrides: Record<string, unknown>): Record<string, unknown> {
      return {
        flightNumber: "LH506",
        departureCode: "FRA",
        arrivalCode: "GRU",
        departureTime: "2026-08-28T22:05",
        arrivalTime: "2026-08-29T05:25",
        airline: "Lufthansa",
        pnr: "9VLVKC",
        ...overrides,
      };
    }

    it("maps totalPrice and currency onto every leg's ParsedBooking", async () => {
      nextResponse = [
        leg({ totalPrice: 4359.14, currency: "EUR" }),
        leg({ flightNumber: "LH507", departureCode: "GRU", arrivalCode: "FRA", totalPrice: 4359.14, currency: "EUR" }),
      ];
      const parser = new OllamaTextParser(baseUrl, "test-model");
      const result = await parser.parseEmail("Buchung", "Endpreis EUR 4,359.14");

      expect(result).toHaveLength(2);
      expect(result[0].price).toBe("4359.14");
      expect(result[0].currency).toBe("EUR");
      expect(result[1].price).toBe("4359.14");
      expect(result[1].currency).toBe("EUR");
    });

    it("lowercase currency codes are normalised to uppercase", async () => {
      nextResponse = [leg({ totalPrice: 857, currency: "eur" })];
      const parser = new OllamaTextParser(baseUrl, "test-model");
      const result = await parser.parseEmail("Buchung", "Endpreis EUR 857,00");

      expect(result[0].price).toBe("857");
      expect(result[0].currency).toBe("EUR");
    });

    it("drops non-numeric, non-positive and non-finite prices instead of guessing", async () => {
      const cases: Array<Record<string, unknown>> = [
        { totalPrice: "4,359.14", currency: "EUR" },
        { totalPrice: -5, currency: "EUR" },
        { totalPrice: 0, currency: "EUR" },
        { totalPrice: Number.NaN, currency: "EUR" },
      ];
      const parser = new OllamaTextParser(baseUrl, "test-model");
      for (const c of cases) {
        nextResponse = [leg(c)];
        const result = await parser.parseEmail("Buchung", "irrelevant");
        expect(result[0].price).toBeUndefined();
      }
    });

    it("drops currency values that are not a 3-letter code", async () => {
      nextResponse = [leg({ totalPrice: 100, currency: "Euros" })];
      const parser = new OllamaTextParser(baseUrl, "test-model");
      const result = await parser.parseEmail("Buchung", "irrelevant");

      expect(result[0].price).toBe("100");
      expect(result[0].currency).toBeUndefined();
    });

    it("leaves price and currency undefined when the model reports none", async () => {
      nextResponse = [leg({})];
      const parser = new OllamaTextParser(baseUrl, "test-model");
      const result = await parser.parseEmail("Buchung", "no price stated");

      expect(result[0].price).toBeUndefined();
      expect(result[0].currency).toBeUndefined();
    });
  });
});
