jest.mock("../../parsers/userTemplates/v2UserTemplates", () => ({
  loadActiveWorkshopTemplates: jest.fn(),
}));
jest.mock("../../llm/llmGate", () => ({ llmRefusalFor: jest.fn() }));
jest.mock("../../llm/llmProvider", () => ({
  llmGenerateChain: jest.fn(),
  describeLlmTarget: jest.fn(),
}));

import { previewFerryText } from "../ticketPreview";
import { loadActiveWorkshopTemplates } from "../../parsers/userTemplates/v2UserTemplates";
import { deriveFerryTemplate } from "../../parsers/userTemplates/rideDeriver";
import { llmGenerateChain } from "../../llm/llmProvider";
import { llmRefusalFor } from "../../llm/llmGate";
import {
  FERRY_HELD_OUT,
  FERRY_SELECTIONS,
  FERRY_SOURCE,
  FERRY_SUBJECT,
} from "../../parsers/userTemplates/__tests__/rideSamples";

/**
 * forgejo#309: the ferry ticket preview asks the ferry templates first — the
 * user's own workshop template among them — and only falls back to labelled
 * facts and the model for a ticket no template reads.
 */
const mockLoad = loadActiveWorkshopTemplates as jest.Mock;

function ferryTemplate() {
  const result = deriveFerryTemplate({
    trainingDataId: "td-ferry-preview",
    subject: FERRY_SUBJECT,
    fullText: FERRY_SOURCE,
    selections: FERRY_SELECTIONS,
  });
  if (!result.ok) throw new Error(result.refusal);
  return result.template;
}

beforeEach(() => jest.clearAllMocks());

it("reads a ticket through the user's ferry template without asking a model", async () => {
  mockLoad.mockResolvedValue([ferryTemplate()]);
  const result = await previewFerryText(`${FERRY_SUBJECT}\n${FERRY_HELD_OUT}`, "user-1");
  expect(mockLoad).toHaveBeenCalledWith("user-1", "ferry");
  expect(llmGenerateChain).not.toHaveBeenCalled();
  expect(result.parser).toBe("template");
  expect(result).toMatchObject({
    template: { id: "ferry:user-td-ferry-preview", source: "workshop" },
  });
  expect(result.crossings).toEqual([
    {
      departurePort: { value: "Probehafen", evidence: "Probehafen" },
      arrivalPort: { value: "Beispieloog", evidence: "Beispieloog" },
      departureLocal: { value: "2028-08-01T23:30", evidence: "2028-08-01T23:30" },
      arrivalLocal: { value: "2028-08-02T01:05", evidence: "2028-08-02T01:05" },
      vesselName: { value: "MS Seebrise Probe", evidence: "MS Seebrise Probe" },
      bookingReference: { value: "IPS990001", evidence: "IPS990001" },
      price: { value: "43", evidence: "43" },
    },
  ]);
});

it("falls back to the labelled facts when no template reads the ticket", async () => {
  mockLoad.mockResolvedValue([]);
  (llmRefusalFor as jest.Mock).mockResolvedValue({ kind: "disabled" });
  const result = await previewFerryText(
    "Departure port: Bari\nArrival port: Durrës\nDeparture: 20.10.2026 22:00",
    "user-1"
  );
  expect(result.parser).toBe("labels");
  expect(result.crossings[0]).toMatchObject({ departurePort: { value: "Bari" } });
});
