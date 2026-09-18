import { parseEmail } from "../email";
import { getTextParserInstance } from "../providers";
import { getParserOrder } from "../../parserSettings";
import { TemplateParser } from "../text/templateParser";
import { clearAvailabilityCache } from "../config";
import type { ITextParser } from "../types";

jest.mock("../providers");
jest.mock("../userTemplates/matcher", () => ({ findMatchingTemplate: jest.fn(async () => null) }));
jest.mock("../../parserSettings", () => ({
  getParserOrder: jest.fn(async () => "template_first"),
}));
jest.mock(
  "../../parserLogging",
  () => ({ shouldLogParserOperations: jest.fn(async () => false) }),
  {
    virtual: true,
  }
);

/**
 * Which reader looks at a flight mail first is an ADMIN SETTING since
 * 2026-09-17, and the same setting in all four domains (forgejo#125).
 *
 * It used to be hardcoded as "a configured Ollama wins", which measured badly
 * the day anyone measured it: on the owner's 31 flight mails the template
 * chain answered every one in under a second, and gemma3:12b took 19 minutes
 * and missed three. So the DEFAULT changed with it — template first, model
 * second — and both directions are pinned here, because the old order has to
 * stay reachable for an instance whose senders no template knows.
 *
 * The assertion is on the ORDER the two readers are entered in, not on the
 * result: with neither reader able to make sense of the text, the chain ends
 * in a throw either way, and a test that asserted the outcome would pass for
 * the wrong reason.
 */
const mockedGetTextParserInstance = getTextParserInstance as jest.MockedFunction<
  typeof getTextParserInstance
>;
const mockedGetParserOrder = getParserOrder as jest.MockedFunction<typeof getParserOrder>;

describe("the admin setting decides who reads a flight mail first", () => {
  let entered: string[];

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    // Availability is cached per provider. Without this the second case reads
    // the first case's cached "ollama is up" and never enters the provider,
    // so the probe below would record an order that never happened.
    clearAvailabilityCache();
    entered = [];

    jest.spyOn(TemplateParser.prototype, "checkAvailability").mockImplementation(async () => {
      entered.push("template");
      return { available: true };
    });
    jest.spyOn(TemplateParser.prototype, "parseEmail").mockImplementation(async () => []);

    mockedGetTextParserInstance.mockImplementation(
      () =>
        ({
          provider: "ollama",
          checkAvailability: jest.fn(async () => {
            entered.push("ollama");
            return { available: true };
          }),
          parseEmail: jest.fn(async () => []),
        }) as unknown as ITextParser
    );
  });

  const run = async (): Promise<void> => {
    try {
      await parseEmail("Ihre Buchung", "Nothing either reader knows.", undefined, {
        visionProvider: "tesseract",
        textProvider: "regex",
        visionFallbacks: [],
        textFallbacks: ["ollama", "regex"],
        ollamaUrl: "http://127.0.0.1:9",
        ollamaModel: "gemma3:12b",
      });
    } catch {
      // Neither reader can answer this text; the chain ending in a throw is
      // not what this test is about.
    }
  };

  it("enters the templates before the model under template_first", async () => {
    mockedGetParserOrder.mockResolvedValue("template_first");
    await run();
    expect(entered[0]).toBe("template");
  });

  it("enters the model first under llm_first — the order that used to be hardcoded", async () => {
    mockedGetParserOrder.mockResolvedValue("llm_first");
    await run();
    expect(entered[0]).toBe("ollama");
  });
});
