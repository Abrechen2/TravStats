import { parseEmail } from "../email";
import { getTextParserInstance } from "../providers";
import type { ITextParser } from "../types";
import type { ParsedBooking } from "../../bookingParser";

jest.mock("../providers");
jest.mock("../userTemplates/matcher", () => ({ findMatchingTemplate: jest.fn(async () => null) }));
jest.mock("../../parserLogging", () => ({ shouldLogParserOperations: jest.fn(async () => false) }), {
  virtual: true,
});

/**
 * Forgejo #35: the #17 evidence gate lived in `regexParser` alone, and
 * `email.ts` makes the template chain the FALLBACK — Ollama answers first. So
 * on every instance with Ollama configured (prod and the RC both are) the
 * guarded path never ran, and a marketing promotion came back as three flights
 * with every field null.
 *
 * This test drives the factory with a provider that returns exactly that shape.
 * A unit test of the filter alone would have passed throughout the bug: what
 * had to be proven is that the FACTORY applies it to whatever answered.
 */
const mockedGetTextParserInstance = getTextParserInstance as jest.MockedFunction<
  typeof getTextParserInstance
>;

function providerReturning(flights: ParsedBooking[]): ITextParser {
  return {
    provider: "ollama",
    checkAvailability: jest.fn(async () => ({ available: true })),
    parseEmail: jest.fn(async () => flights),
  } as unknown as ITextParser;
}

// `ollamaConfigured` in email.ts is `!!config.ollamaUrl && fallbacks.includes("ollama")`
// — both halves are required to reach the branch this test is about.
const config = {
  textProvider: "ollama",
  textFallbacks: ["ollama"],
  ollamaUrl: "http://ollama.invalid:11434",
  ollamaModel: "gemma3:12b",
} as never;

describe("the parser factory drops candidates that identify no flight", () => {
  afterEach(() => jest.clearAllMocks());

  it("returns nothing when the provider invents three empty candidates", async () => {
    mockedGetTextParserInstance.mockReturnValue(
      providerReturning([{}, {}, {}] as ParsedBooking[])
    );

    const result = await parseEmail(
      "Nur 7 Tage gültig: Ihr 30 EUR Oster-Geschenk",
      "Sichern Sie sich jetzt Ihr Geschenk. Gültig bis 21.04.2014.",
      undefined,
      config
    );

    expect(result.flights).toEqual([]);
  });

  it("keeps a candidate the provider identified properly", async () => {
    // Control probe. Without it the test above would also pass against a
    // factory that returns nothing at all, which would be a worse bug than the
    // one being fixed.
    mockedGetTextParserInstance.mockReturnValue(
      providerReturning([
        { flightNumber: "AF1123" } as ParsedBooking,
        { departureCode: "MUC", arrivalCode: "CDG" } as ParsedBooking,
      ])
    );

    const result = await parseEmail(
      "Bestätigung Ihrer Air France Flugbuchung",
      "MUC 07:20 CDG 09:00",
      undefined,
      config
    );

    expect(result.flights).toHaveLength(2);
  });
});
