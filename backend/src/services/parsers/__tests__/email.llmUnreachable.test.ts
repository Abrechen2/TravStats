import { parseEmail } from "../email";
import { getTextParserInstance } from "../providers";
import { deleteAvailabilityCacheEntry } from "../config";
import type { ITextParser, TextProvider } from "../types";

jest.mock("../providers");
jest.mock("../userTemplates/matcher", () => ({ findMatchingTemplate: jest.fn(async () => null) }));

/**
 * Silent-failure review 2026-09-26, finding 8. The templates read the mail and
 * found nothing, the configured Ollama behind them was down, and the answer was
 * a plain 200 with an empty list — "Keine Flüge in der E-Mail" — although the
 * one reader that might have found the flight was never asked.
 *
 * An empty answer stays an answer (Forgejo #35); it now says when it is the
 * templates' alone.
 */
const mockedGetTextParserInstance = getTextParserInstance as jest.MockedFunction<
  typeof getTextParserInstance
>;

const emptyRegex = {
  provider: "regex",
  checkAvailability: jest.fn(async () => ({ available: true })),
  parseEmail: jest.fn(async () => []),
} as unknown as ITextParser;

const downOllama = {
  provider: "ollama",
  checkAvailability: jest.fn(async () => ({ available: false, reason: "connect ECONNREFUSED" })),
  parseEmail: jest.fn(async () => []),
} as unknown as ITextParser;

const byProvider = (provider: TextProvider): ITextParser =>
  provider === "ollama" ? downOllama : emptyRegex;

const SUBJECT = "Ihre Buchungsbestätigung";
const BODY = "Vielen Dank für Ihre Buchung.";

describe("an empty email parse says when the configured LLM could not be asked", () => {
  beforeEach(() => {
    mockedGetTextParserInstance.mockImplementation(byProvider as never);
  });
  afterEach(() => {
    jest.clearAllMocks();
    deleteAvailabilityCacheEntry("regex-default");
    deleteAvailabilityCacheEntry("ollama-default");
  });

  it("flags llmUnreachable when Ollama is configured but down", async () => {
    const result = await parseEmail(SUBJECT, BODY, undefined, {
      textProvider: "regex",
      textFallbacks: ["regex", "ollama"],
      ollamaUrl: "http://ollama.invalid:11434",
    } as never);

    expect(result.flights).toEqual([]);
    expect(result.llmUnreachable).toBe(true);
  });

  it("does not flag it on an instance with no model configured", async () => {
    const result = await parseEmail(SUBJECT, BODY, undefined, {
      textProvider: "regex",
      textFallbacks: ["regex", "ollama"],
    } as never);

    expect(result.flights).toEqual([]);
    expect(result.llmUnreachable).toBeUndefined();
  });
});
