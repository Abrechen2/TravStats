import { parseEmail } from "../email";
import { getTextParserInstance } from "../providers";
import { getParserOrder } from "../../parserSettings";
import { TemplateParser } from "../text/templateParser";
import { clearAvailabilityCache } from "../config";
import { findMatchingTemplate } from "../userTemplates/matcher";
import { applyUserTemplate } from "../userTemplates/engine";
import type { ITextParser, ParserConfig } from "../types";

jest.mock("../providers");
jest.mock("../userTemplates/matcher", () => ({ findMatchingTemplate: jest.fn(async () => null) }));
jest.mock("../userTemplates/engine", () => ({ applyUserTemplate: jest.fn(() => []) }));
jest.mock("../../parserSettings", () => ({
  getParserOrder: jest.fn(async () => "template_first"),
}));

/**
 * Characterization of the steps of `parseEmail` (forgejo#386 REF-15): the
 * function was split into one function per step, and these pin the exits that
 * the order/evidence suites do not reach.
 */
const mockedProvider = getTextParserInstance as jest.MockedFunction<typeof getTextParserInstance>;
const mockedOrder = getParserOrder as jest.MockedFunction<typeof getParserOrder>;
const mockedMatch = findMatchingTemplate as jest.MockedFunction<typeof findMatchingTemplate>;
const mockedApply = applyUserTemplate as jest.MockedFunction<typeof applyUserTemplate>;

const config: ParserConfig = {
  visionProvider: "tesseract",
  textProvider: "regex",
  visionFallbacks: [],
  textFallbacks: ["ollama", "regex"],
  ollamaUrl: "http://127.0.0.1:9",
  ollamaModel: "gemma3:12b",
};

const reader = (name: string, available: boolean, flights: unknown[] = [], reason?: string) =>
  ({
    provider: name,
    checkAvailability: jest.fn(async () => ({ available, reason })),
    parseEmail: jest.fn(async () => flights),
  }) as unknown as ITextParser;

describe("parseEmail chain steps", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    clearAvailabilityCache();
    mockedOrder.mockResolvedValue("template_first");
    mockedMatch.mockResolvedValue(null);
    jest
      .spyOn(TemplateParser.prototype, "checkAvailability")
      .mockResolvedValue({ available: true });
    jest
      .spyOn(TemplateParser.prototype, "read")
      .mockResolvedValue({ flights: [], nonBooking: false });
  });

  it("ends the chain with no flights when a template recognises a non-booking", async () => {
    jest
      .spyOn(TemplateParser.prototype, "read")
      .mockResolvedValue({ flights: [], nonBooking: true });
    const result = await parseEmail("Storno", "Your booking is cancelled", undefined, config);
    expect(result).toEqual({ flights: [], provider: "regex", fallbackUsed: false });
    expect(mockedProvider).not.toHaveBeenCalled();
  });

  it("flags llmUnreachable and still answers empty when the llm-first model is down", async () => {
    mockedOrder.mockResolvedValue("llm_first");
    mockedProvider.mockImplementation((p) =>
      p === "ollama" ? reader(p, false, [], "down") : reader(p, true, [])
    );
    const result = await parseEmail("Mail", "Nothing here", undefined, config);
    expect(result.flights).toEqual([]);
    expect(result.llmUnreachable).toBe(true);
  });

  it("flags llmUnreachable when the llm-first model throws mid-parse", async () => {
    mockedOrder.mockResolvedValue("llm_first");
    const broken = reader("ollama", true);
    (broken.parseEmail as jest.Mock).mockRejectedValue(new Error("boom"));
    mockedProvider.mockImplementation((p) => (p === "ollama" ? broken : reader(p, true, [])));
    const result = await parseEmail("Mail", "Nothing here", undefined, config);
    expect(result.llmUnreachable).toBe(true);
  });

  it("does not ask the model again in the chain after llm-first answered empty", async () => {
    mockedOrder.mockResolvedValue("llm_first");
    const asked: string[] = [];
    mockedProvider.mockImplementation((p) => {
      const r = reader(p, true, []);
      (r.parseEmail as jest.Mock).mockImplementation(async () => {
        asked.push(p);
        return [];
      });
      return r;
    });
    const result = await parseEmail("Mail", "Nothing here", undefined, config);
    expect(asked).toEqual(["ollama", "regex"]);
    expect(result.provider).toBe("regex");
    expect(result.llmUnreachable).toBeUndefined();
  });

  it("returns the user template's flights when its confidence is at least 80", async () => {
    mockedMatch.mockResolvedValue({ name: "mine" } as never);
    mockedApply.mockReturnValue([
      { flightNumber: "LH400", parserConfidence: 90 },
    ] as unknown as ReturnType<typeof applyUserTemplate>);
    const result = await parseEmail("LH400", "Flug LH400 am 1.1.", undefined, {
      ...config,
      userId: "u1",
    });
    expect(result.provider).toBe("regex");
    expect(mockedMatch).toHaveBeenCalledWith("u1", "flight", "", "LH400", expect.any(String));
    expect(mockedProvider).not.toHaveBeenCalled();
  });

  it("carries on past a user template below 80 confidence", async () => {
    mockedMatch.mockResolvedValue({ name: "mine" } as never);
    mockedApply.mockReturnValue([
      { flightNumber: "LH400", parserConfidence: 40 },
    ] as unknown as ReturnType<typeof applyUserTemplate>);
    mockedProvider.mockImplementation((p) => reader(p, true, []));
    const result = await parseEmail("Mail", "From: a@b.de\nNothing", undefined, {
      ...config,
      userId: "u1",
    });
    expect(mockedMatch).toHaveBeenCalledWith("u1", "flight", "a@b.de", "Mail", expect.any(String));
    expect(result.flights).toEqual([]);
  });

  it("throws when every provider failed", async () => {
    const broken = reader("ollama", true);
    (broken.parseEmail as jest.Mock).mockRejectedValue(new Error("boom"));
    mockedProvider.mockImplementation(() => broken);
    await expect(parseEmail("Mail", "Text", undefined, config)).rejects.toThrow(
      /All text parsers failed.*ollama: boom; regex: boom/
    );
  });
});
