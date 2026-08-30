import { parseEmail } from "../email";
import { getTextParserInstance } from "../providers";
import { deleteAvailabilityCacheEntry } from "../config";
import type { ITextParser } from "../types";
import type { ParsedBooking } from "../../bookingParser";

jest.mock("../providers");
jest.mock("../userTemplates/matcher", () => ({ findMatchingTemplate: jest.fn(async () => null) }));
jest.mock(
  "../../parserLogging",
  () => ({ shouldLogParserOperations: jest.fn(async () => false) }),
  {
    virtual: true,
  }
);

/**
 * Forgejo #35, the status-code half. A parser that reads a mail and finds no
 * booking was treated as a parser that FAILED: the factory threw "Parser
 * returned no flights", the catch filed it under `errors`, the chain ran out,
 * and the caller got "All text parsers failed" — which `describeParserError`
 * turns into HTTP 500.
 *
 * Measured against the archived promotions: two of the eight Emirates
 * advertising mails answered 500 that way. A mail with no flight in it is not a
 * server fault, and the import modal saying "email parsing failed" sends the
 * user looking for a broken instance.
 *
 * The distinction that has to survive: a provider that RAN and found nothing
 * yields an empty list, a provider that could not run at all still fails the
 * request.
 */
const mockedGetTextParserInstance = getTextParserInstance as jest.MockedFunction<
  typeof getTextParserInstance
>;

function providerReturning(flights: ParsedBooking[]): ITextParser {
  return {
    provider: "regex",
    checkAvailability: jest.fn(async () => ({ available: true })),
    parseEmail: jest.fn(async () => flights),
  } as unknown as ITextParser;
}

function providerUnavailable(reason: string): ITextParser {
  return {
    provider: "regex",
    checkAvailability: jest.fn(async () => ({ available: false, reason })),
    parseEmail: jest.fn(async () => []),
  } as unknown as ITextParser;
}

function providerThrowing(message: string): ITextParser {
  return {
    provider: "regex",
    checkAvailability: jest.fn(async () => ({ available: true })),
    parseEmail: jest.fn(async () => {
      throw new Error(message);
    }),
  } as unknown as ITextParser;
}

const config = { textProvider: "regex", textFallbacks: ["regex"] } as never;

const MARKETING_SUBJECT = "Mit Emirates kulinarisch die Welt entdecken!";
const MARKETING_BODY = "Entdecken Sie die Welt. Jetzt informieren und buchen.";

describe("a mail with no booking in it is an answer, not a failure", () => {
  afterEach(() => {
    jest.clearAllMocks();
    // `checkProviderAvailability` memoises per `${provider}-${apiKey}`, and that
    // cache is module state which `clearAllMocks` does not touch. All three
    // providers below call themselves "regex", so without this the first test's
    // "available" verdict is handed to the next one and the unavailable case
    // quietly stops testing anything.
    deleteAvailabilityCacheEntry("regex-default");
  });

  it("returns an empty list instead of throwing when the provider finds nothing", async () => {
    mockedGetTextParserInstance.mockReturnValue(providerReturning([]));

    const result = await parseEmail(MARKETING_SUBJECT, MARKETING_BODY, undefined, config);

    expect(result.flights).toEqual([]);
    expect(result.provider).toBe("regex");
  });

  it("still fails the request when the only provider cannot run", async () => {
    mockedGetTextParserInstance.mockReturnValue(providerUnavailable("Ollama unreachable"));

    await expect(parseEmail(MARKETING_SUBJECT, MARKETING_BODY, undefined, config)).rejects.toThrow(
      /All text parsers failed/
    );
  });

  it("still fails the request when the provider throws", async () => {
    mockedGetTextParserInstance.mockReturnValue(providerThrowing("connect ECONNREFUSED"));

    await expect(parseEmail(MARKETING_SUBJECT, MARKETING_BODY, undefined, config)).rejects.toThrow(
      /All text parsers failed/
    );
  });
});
