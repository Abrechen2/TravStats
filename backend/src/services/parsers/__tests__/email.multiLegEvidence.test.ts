/**
 * The generic reader pairs flight numbers with routes and times by POSITION.
 * When the factory's evidence gate then drops one leg of such a result, the
 * pairing the survivors carry was made with the dropped leg in the count — so
 * the survivors are suspect, and a two-leg trip would otherwise come back as a
 * one-way flight. Review finding, 2026-10-01: the regex result is declined
 * whole instead.
 *
 * Driven through the factory with the real `RegexTextParser`, on invented text.
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

// The first number has a clock time beside it (its second witness); the
// second stands more than the witness window away from any time and the text
// names no booking, so the evidence gate drops it.
const FILLER = "Hinweise zum Gepäck und zur Anreise finden Sie in unseren Reiseinformationen. ";
const TWO_LEGS = ["Flug: LH 400 um 10:15 Uhr", FILLER.repeat(4), "Flug: LH 401"].join("\n");

describe("a multi-leg regex result the evidence gate thins out", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetTextParserInstance.mockReturnValue(new RegexTextParser());
  });

  it("reads both legs before the gate (fixture check)", async () => {
    const legs = await new RegexTextParser().parseEmail("", TWO_LEGS);
    expect(legs.map((f) => f.flightNumber)).toEqual(["LH400", "LH401"]);
  });

  it("is declined whole rather than returned as a one-way flight", async () => {
    const result = await parseEmail("", TWO_LEGS, undefined, config);
    expect(result.flights).toEqual([]);
  });

  it("still returns a single regex leg the gate keeps", async () => {
    const result = await parseEmail("", "Flug: LH 400 um 10:15 Uhr", undefined, config);
    expect(result.flights.map((f) => f.flightNumber)).toEqual(["LH400"]);
  });
});
