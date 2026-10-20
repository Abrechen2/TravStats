jest.mock("../../../parserSettings", () => ({
  getAdminParserSettings: jest.fn(async () => ({ ollamaUrl: null, ollamaModel: "test-model" })),
  getParserOrder: jest.fn(async () => "template_first"),
}));
jest.mock("../../../parsers/llmAvailability", () => ({
  isLlmAvailable: jest.fn(async () => false),
  recordLlmProbe: jest.fn(),
}));
// The model is switched off: a document no template reads ends in a coded
// refusal here, never in a network call.
jest.mock("../../../llm/llmGate", () => ({
  llmRefusalFor: jest.fn(async () => ({ kind: "disabled_by_admin", reason: "off" })),
}));
jest.mock("../../../parsers/userTemplates/v2UserTemplates", () => ({
  loadActiveWorkshopTemplates: jest.fn(),
}));

import { parseRailBookingText } from "../railBookingParser";
import { loadActiveWorkshopTemplates } from "../../../parsers/userTemplates/v2UserTemplates";
import { deriveRailTemplate } from "../../../parsers/userTemplates/railDeriver";
import {
  RAIL_HELD_OUT,
  RAIL_SELECTIONS,
  RAIL_SOURCE,
  RAIL_SUBJECT,
} from "../../../parsers/userTemplates/__tests__/railSamples";

/**
 * forgejo#309: a rail document no repository template reads is read by the
 * caller's own ACTIVE workshop template — asked for by user and domain, after
 * the repository's readers, exactly as cruise and lodging do it.
 */
const mockLoad = loadActiveWorkshopTemplates as jest.Mock;

function workshopTemplate() {
  const result = deriveRailTemplate({
    trainingDataId: "td-rail-parse",
    subject: RAIL_SUBJECT,
    fullText: RAIL_SOURCE,
    selections: RAIL_SELECTIONS,
  });
  if (!result.ok) throw new Error(result.refusal);
  return result.template;
}

describe("parseRailBookingText with the user's workshop templates", () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockLoad.mockResolvedValue([workshopTemplate()]);
  });

  it("reads a booking through the caller's active rail template", async () => {
    const result = await parseRailBookingText(`${RAIL_SUBJECT}\n${RAIL_HELD_OUT}`, [], "user-1");
    expect(mockLoad).toHaveBeenCalledWith("user-1", "rail");
    expect(result.parserUsed).toBe("template");
    expect(result.booking?.source).toBe("workshop");
    expect(result.booking?.legs.map((l) => [l.depStationName, l.departureLocal])).toEqual([
      ["Ulm Hbf", "2027-12-03T06:05"],
      ["Augsburg Hbf", "2027-12-03T07:02"],
      ["Nürnberg Hbf", "2027-12-05T23:40"],
    ]);
  });

  it("asks for no workshop template when no user is known, and says why nothing was read", async () => {
    const result = await parseRailBookingText(`${RAIL_SUBJECT}\n${RAIL_HELD_OUT}`, []);
    expect(mockLoad).not.toHaveBeenCalled();
    expect(result.booking).toBeNull();
    expect(result.fallbackCode).toBe("llmDisabled");
  });
});
