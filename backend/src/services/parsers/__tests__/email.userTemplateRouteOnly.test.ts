/**
 * A user-derived template that reads several legs with routes but no flight
 * numbers must be declined like the generic reader's identical result
 * (`route_only_legs_in_multi_leg_document`): the pairing is positional. Before
 * the fix the user-template branch only ran the evidence gate, which keeps a
 * route-complete leg, so the guess went through.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
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
  findMatchingTemplate: jest.fn(async () => ({ name: "mine" })),
  matchesFingerprint: jest.fn(),
}));
jest.mock("../userTemplates/engine", () => ({ applyUserTemplate: jest.fn() }));
jest.mock("../providers", () => ({
  getTextParserInstance: jest.fn(() => ({
    parseEmail: jest.fn(async () => []),
    checkAvailability: async () => ({ available: true }),
  })),
}));
jest.mock("../../parserSettings", () => ({
  getParserOrder: jest.fn(async () => "template_first"),
}));

import { parseEmail } from "../email";
import { applyUserTemplate } from "../userTemplates/engine";

const config = {
  textProvider: "regex",
  textFallbacks: ["regex"],
  visionFallbacks: [],
  userId: "u1",
} as never;
const leg = (dep: string, arr: string, flightNumber?: string) => ({
  departureCode: dep,
  arrivalCode: arr,
  ...(flightNumber ? { flightNumber } : {}),
  parserConfidence: 90,
  missing: [],
});

describe("user template with route-only legs", () => {
  beforeEach(() => jest.clearAllMocks());

  it("declines a multi-leg user-template result without flight numbers", async () => {
    (applyUserTemplate as jest.Mock).mockReturnValue([leg("FRA", "HRG"), leg("HRG", "FRA")]);
    const r = await parseEmail("Reise", "FRA HRG FRA", undefined, config);
    expect(r.flights).toEqual([]);
  });

  it("keeps a multi-leg user-template result that carries flight numbers", async () => {
    (applyUserTemplate as jest.Mock).mockReturnValue([
      leg("FRA", "HRG", "LH1234"),
      leg("HRG", "FRA", "LH1235"),
    ]);
    const r = await parseEmail("Reise", "FRA HRG FRA", undefined, config);
    expect(r.flights.map((f) => f.flightNumber)).toEqual(["LH1234", "LH1235"]);
  });
});
