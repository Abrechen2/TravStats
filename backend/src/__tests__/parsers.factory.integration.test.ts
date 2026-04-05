/**
 * Integration tests for the parseEmail fallback chain in email.ts
 *
 * The 3-step chain:
 *   Step 0: User-derived template (findMatchingTemplate + applyUserTemplate) — confidence ≥ 80 → return
 *   Step 1: TemplateParser (checkAvailability + parseEmail) — confidence ≥ 30 → return
 *   Step 2: LLM provider chain (getTextParserInstance per provider)
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// ── Logger ────────────────────────────────────────────────────────────────────
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: mockLogger,
  parserFactoryLogger: mockLogger,
  parserTextLogger: mockLogger,
  httpLogger: mockLogger,
  dbLogger: mockLogger,
  parserLogger: mockLogger,
  parserVisionLogger: mockLogger,
  parserTextLogger2: mockLogger,
  securityLogger: mockLogger,
  systemLogger: mockLogger,
}));

// ── DB (Prisma) ───────────────────────────────────────────────────────────────
jest.mock("../db", () => ({
  prisma: {
    userTemplate: { findMany: jest.fn() },
    logConfig: { findUnique: jest.fn() },
  },
}));

// ── Logging config ────────────────────────────────────────────────────────────
jest.mock("../services/loggingConfig", () => ({
  shouldLogParserOperations: jest.fn(),
  getLoggingConfig: jest.fn(),
}));

// ── User template matcher ─────────────────────────────────────────────────────
jest.mock("../services/parsers/userTemplates/matcher", () => ({
  findMatchingTemplate: jest.fn(),
  matchesFingerprint: jest.fn(),
}));

// ── User template engine ──────────────────────────────────────────────────────
jest.mock("../services/parsers/userTemplates/engine", () => ({
  applyUserTemplate: jest.fn(),
}));

// ── TemplateParser ────────────────────────────────────────────────────────────
const mockTemplateParserCheckAvailability = jest.fn();
const mockTemplateParserParseEmail = jest.fn();

jest.mock("../services/parsers/text/templateParser", () => ({
  TemplateParser: jest.fn().mockImplementation(() => ({
    checkAvailability: mockTemplateParserCheckAvailability,
    parseEmail: mockTemplateParserParseEmail,
  })),
}));

// ── Providers ─────────────────────────────────────────────────────────────────
jest.mock("../services/parsers/providers", () => ({
  getTextParserInstance: jest.fn(),
  getVisionParserInstance: jest.fn(),
}));

// ── Config (availability + cache) ────────────────────────────────────────────
jest.mock("../services/parsers/config", () => ({
  checkProviderAvailability: jest.fn(),
  deleteAvailabilityCacheEntry: jest.fn(),
  getDefaultTextFallbackChain: jest.fn().mockReturnValue(["regex"]),
  getParserConfig: jest.fn(),
}));

// ── Model manager ─────────────────────────────────────────────────────────────
jest.mock("../services/modelManager", () => ({
  selectModelForParsing: jest.fn().mockResolvedValue(undefined),
}));

// ── BoardingPass quality ──────────────────────────────────────────────────────
jest.mock("../services/parsers/boardingPass", () => ({
  calculateParserQuality: jest.fn(),
  parseBoardingPass: jest.fn(),
}));

// ── Parser feedback ───────────────────────────────────────────────────────────
jest.mock("../services/parserFeedback", () => ({
  collectLowQualityFeedback: jest.fn().mockResolvedValue(undefined),
  collectParserFeedback: jest.fn().mockResolvedValue(undefined),
  collectCorrectionFeedback: jest.fn().mockResolvedValue(undefined),
}));

// ── Shared utils (extractFlightDataFromText used in post-processing) ──────────
jest.mock("../services/parsers/shared/utils", () => ({
  extractFlightDataFromText: jest.fn().mockReturnValue({}),
}));

// ── Import service AFTER mocks ────────────────────────────────────────────────
import { parseEmail } from "../services/parsers/email";
import { findMatchingTemplate } from "../services/parsers/userTemplates/matcher";
import { applyUserTemplate } from "../services/parsers/userTemplates/engine";
import { getTextParserInstance } from "../services/parsers/providers";
import { checkProviderAvailability } from "../services/parsers/config";
import { calculateParserQuality } from "../services/parsers/boardingPass";
import { shouldLogParserOperations } from "../services/loggingConfig";
import { TemplateParser } from "../services/parsers/text/templateParser";
import type { TextProvider } from "../services/parsers/types";

// ── Typed mock helpers ────────────────────────────────────────────────────────
const mockFindMatchingTemplate = findMatchingTemplate as jest.MockedFunction<typeof findMatchingTemplate>;
const mockApplyUserTemplate = applyUserTemplate as jest.MockedFunction<typeof applyUserTemplate>;
const mockGetTextParserInstance = getTextParserInstance as jest.MockedFunction<typeof getTextParserInstance>;
const mockCheckProviderAvailability = checkProviderAvailability as jest.MockedFunction<typeof checkProviderAvailability>;
const mockCalculateParserQuality = calculateParserQuality as jest.MockedFunction<typeof calculateParserQuality>;
const mockShouldLogParserOperations = shouldLogParserOperations as jest.MockedFunction<typeof shouldLogParserOperations>;

// ── Base config used across tests ─────────────────────────────────────────────
const BASE_CONFIG = {
  visionProvider: "tesseract" as const,
  textProvider: "regex" as const,
  visionFallbacks: [] as never[],
  textFallbacks: ["regex"] as TextProvider[],
  userId: undefined,
};

const MOCK_FLIGHT = {
  flightNumber: "LH400",
  departureAirport: "FRA",
  arrivalAirport: "JFK",
  departureDate: "2026-05-01",
  parserConfidence: 85,
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("parseEmail — fallback chain", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no verbose logging
    mockShouldLogParserOperations.mockResolvedValue(false);
    // Default: quality above low-quality threshold to avoid LLM fallback logic
    mockCalculateParserQuality.mockReturnValue(80);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 1: User template with high confidence (≥80) → return immediately
  // ────────────────────────────────────────────────────────────────────────────
  it("returns user-template result immediately when confidence ≥ 80, skipping TemplateParser and LLM", async () => {
    const config = { ...BASE_CONFIG, userId: "user-123" };

    const mockTemplate = { name: "LH-template", patterns: {} };
    mockFindMatchingTemplate.mockResolvedValue(mockTemplate as never);
    mockApplyUserTemplate.mockReturnValue([MOCK_FLIGHT] as never);

    const result = await parseEmail(
      "Your Lufthansa booking confirmation",
      "From: noreply@lufthansa.com\nFlight LH400",
      undefined,
      config
    );

    expect(result.provider).toBe("regex");
    expect(result.fallbackUsed).toBe(false);
    expect(result.flights).toHaveLength(1);
    expect(result.flights[0].flightNumber).toBe("LH400");

    // TemplateParser must NOT have been instantiated (constructor not called)
    expect(TemplateParser).not.toHaveBeenCalled();
    // LLM provider chain must NOT have been invoked
    expect(mockGetTextParserInstance).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 2: No user templates → TemplateParser with confidence ≥ 30 → return
  // ────────────────────────────────────────────────────────────────────────────
  it("uses TemplateParser when no user template matches and confidence ≥ 30, skipping LLM chain", async () => {
    // No userId → Step 0 skipped entirely
    const config = { ...BASE_CONFIG };

    const templateFlight = { ...MOCK_FLIGHT, parserConfidence: 90, parserTemplate: "lufthansa-v1" };
    mockTemplateParserCheckAvailability.mockResolvedValue({ available: true });
    mockTemplateParserParseEmail.mockResolvedValue([templateFlight] as never);

    const result = await parseEmail(
      "Booking confirmation",
      "Flight LH400 departing FRA",
      undefined,
      config
    );

    expect(result.provider).toBe("regex");
    expect(result.fallbackUsed).toBe(false);
    expect(result.flights).toHaveLength(1);
    expect(result.flights[0].parserTemplate).toBe("lufthansa-v1");

    // LLM chain must NOT have been invoked
    expect(mockGetTextParserInstance).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 3: Template parser with confidence < 30 → falls through to LLM chain
  // ────────────────────────────────────────────────────────────────────────────
  it("falls through to LLM provider chain when TemplateParser confidence < 30", async () => {
    const config = { ...BASE_CONFIG, textFallbacks: ["regex"] as TextProvider[] };

    // Template parser returns low-confidence result
    const lowConfFlight = { ...MOCK_FLIGHT, parserConfidence: 20 };
    mockTemplateParserCheckAvailability.mockResolvedValue({ available: true });
    mockTemplateParserParseEmail.mockResolvedValue([lowConfFlight] as never);

    // LLM chain: regex provider available and returns a good flight
    const regexFlight = { ...MOCK_FLIGHT, flightNumber: "BA200", parserConfidence: 75 };
    const mockRegexParser = {
      provider: "regex",
      parseEmail: jest.fn<() => Promise<typeof regexFlight[]>>().mockResolvedValue([regexFlight]),
      checkAvailability: jest.fn(),
    };
    mockGetTextParserInstance.mockReturnValue(mockRegexParser as never);
    mockCheckProviderAvailability.mockResolvedValue({ available: true });
    // Quality above 40 → no LLM quality-fallback triggered
    mockCalculateParserQuality.mockReturnValue(75);

    const result = await parseEmail(
      "Booking confirmation",
      "Flight BA200 departing LHR",
      undefined,
      config
    );

    expect(result.flights).toHaveLength(1);
    expect(result.flights[0].flightNumber).toBe("BA200");
    // regex provider was invoked
    expect(mockGetTextParserInstance).toHaveBeenCalledWith("regex");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 5: getParserConfig returns correct providers (Tesseract + Regex only)
  // ────────────────────────────────────────────────────────────────────────────
  it("returns tesseract/regex providers from getParserConfig", async () => {
    const { getParserConfig } = (await jest.requireActual(
      "../services/parsers/config"
    )) as typeof import("../services/parsers/config");
    const config = await getParserConfig(undefined, undefined, undefined);
    expect(config.visionProvider).toBe("tesseract");
    expect(config.textProvider).toBe("regex");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test 4: All providers fail → throws error
  // ────────────────────────────────────────────────────────────────────────────
  it("throws when all providers are unavailable", async () => {
    const config = { ...BASE_CONFIG, textFallbacks: ["regex"] as TextProvider[] };

    // Template parser unavailable
    mockTemplateParserCheckAvailability.mockResolvedValue({
      available: false,
      reason: "No templates loaded",
    });

    // LLM chain: provider unavailable
    const mockRegexParser = {
      provider: "regex",
      parseEmail: jest.fn(),
      checkAvailability: jest.fn(),
    };
    mockGetTextParserInstance.mockReturnValue(mockRegexParser as never);
    mockCheckProviderAvailability.mockResolvedValue({
      available: false,
      reason: "No API key",
    });

    await expect(
      parseEmail(
        "Booking confirmation",
        "Flight BA200 departing LHR",
        undefined,
        config
      )
    ).rejects.toThrow("All text parsers failed");
  });
});
