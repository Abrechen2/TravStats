/**
 * GitHub #291 — "Non-booking emails can still yield an invented flight number".
 *
 * The door that survived the earlier fixes was the REGEX path with the LLM
 * off, which is how a keyless instance runs. Pasting a Facebook campaign into
 * `POST /parse-email` answered with a flight:
 *
 *     {airline: "FB", flightNumber: "FB23", departureTime: "2026-10-30T00:00"}
 *
 * A unit test of the evidence rule alone would not have caught this and does
 * not prove it fixed, because the report is about the whole chain: the regex
 * parser still PRODUCES the candidate, and the gate is what must refuse it.
 * So this drives the real `RegexTextParser` through the real factory, and the
 * control probe below keeps it from passing as a factory that returns nothing.
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

const NEWSLETTER = [
  "Unsere Facebook-Aktion FB23 läuft noch bis Freitag, 30. Oktober 2026.",
  "Flüge nach Barcelona ab 49 EUR.",
  "Ab Flughafen Düsseldorf täglich.",
].join("\n");

describe("a lone flight number out of a non-booking mail (#291)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetTextParserInstance.mockReturnValue(new RegexTextParser());
  });

  it("returns no flight for the reported Facebook-campaign newsletter", async () => {
    const result = await parseEmail("Newsletter Oktober", NEWSLETTER, undefined, config);

    expect(result.flights).toEqual([]);
  });

  it("still returns the flight when a clock time stands beside the number", async () => {
    // The control probe, and the case the rule must not cost us: no route, no
    // booking vocabulary, and still unmistakably a flight.
    const result = await parseEmail("Erinnerung", "LH400 um 07:35", undefined, config);

    expect(result.flights.map((f) => f.flightNumber)).toEqual(["LH400"]);
  });

  it("still returns the flight when the mail says it is a booking", async () => {
    // The Emirates shape from the corpus: an onward leg whose route the parser
    // never recovers, kept whole by the subject line alone.
    const result = await parseEmail(
      "Ihre Buchung ist bestätigt - JLNBLW",
      "EK051 am 05. Februar 2022",
      undefined,
      config
    );

    expect(result.flights.map((f) => f.flightNumber)).toEqual(["EK051"]);
  });
});
