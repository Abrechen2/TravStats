/**
 * Corpus 2026-09-30: two tour-operator invoice PDFs came back as flight GF086
 * "WHO→WHO". The regex reader was not what said so — it returned GF086 with
 * no route, and its own gate rightly let a lone number through to the #291
 * gate. The route was invented AFTER it, by `backfillRoutesFromText` in the
 * factory's post-processing: the invoice printed "(WHO)" twice, one flight
 * needs two bracketed codes, so the two were paired into one leg. The shared
 * evidence gate then took any two-ended route as proof.
 *
 * So this drives the path a PDF takes (`parseBookingText` → the factory's
 * `parseEmail` with no subject) with the real `RegexTextParser`, on an
 * invented invoice of the same shape — no real invoice text.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: mockLogger,
  parserFactoryLogger: mockLogger,
  parserTextLogger: mockLogger,
  parserLogger: mockLogger,
  parserVisionLogger: mockLogger,
  httpLogger: mockLogger,
  dbLogger: mockLogger,
  securityLogger: mockLogger,
  systemLogger: mockLogger,
}));

jest.mock("../../loggingConfig", () => ({
  shouldLogParserOperations: jest.fn(async () => false),
  getLoggingConfig: jest.fn(),
}));

jest.mock("../userTemplates/matcher", () => ({
  findMatchingTemplate: jest.fn(async () => null),
  matchesFingerprint: jest.fn(),
}));

// The HTML-selector templates are switched off so the regex provider is the
// one that answers — this test is about that path and nothing else.
jest.mock("../text/templateParser", () => ({
  TemplateParser: class {
    async checkAvailability() {
      return { available: false, reason: "disabled in this test" };
    }
    async parseEmail() {
      return [];
    }
  },
}));

jest.mock("../../parserSettings", () => ({
  getParserOrder: jest.fn(async () => "template_first"),
}));

import { RegexTextParser } from "../text/regexParser";
import { getTextParserInstance } from "../providers";
import { parseEmail } from "../email";

jest.mock("../providers", () => ({ getTextParserInstance: jest.fn() }));

const mockedGetTextParserInstance = getTextParserInstance as jest.MockedFunction<
  typeof getTextParserInstance
>;

const config = {
  textProvider: "regex",
  textFallbacks: ["regex"],
  visionFallbacks: [],
} as never;

const INVOICE = [
  "RECHNUNG",
  "Reiseveranstalter Beispiel GmbH",
  "Buchungsnummer 555001",
  "Flug GF 086 am 21.03.2027 um 10:45",
  "Hinweise der Weltgesundheitsorganisation (WHO) zu Impfungen beachten.",
  "Merkblatt der Weltgesundheitsorganisation (WHO) liegt bei.",
].join("\n");

describe("a document whose bracketed codes name the same airport twice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetTextParserInstance.mockReturnValue(new RegexTextParser());
  });

  it("never returns a leg from an airport to itself", async () => {
    const result = await parseEmail("", INVOICE, undefined, config);

    const sameAirport = result.flights.filter(
      (f) => f.departureCode && f.departureCode === f.arrivalCode
    );
    expect(sameAirport).toEqual([]);
  });

  it("keeps the flight number without a route, for the lookup to complete", async () => {
    // Incomplete, not wrong: the number is corroborated ("Buchungsnummer"),
    // and the #291 gate is what keeps a lone number — only the invented route
    // has to go.
    const result = await parseEmail("", INVOICE, undefined, config);

    expect(
      result.flights.map((f) => [f.flightNumber, f.departureCode ?? null, f.arrivalCode ?? null])
    ).toEqual([["GF086", null, null]]);
  });
});
