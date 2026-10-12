jest.mock("../../llm/llmGate", () => ({ llmRefusalFor: jest.fn() }));
jest.mock("../../llm/llmProvider", () => ({
  llmGenerateChain: jest.fn(),
  describeLlmTarget: jest.fn(() => ({ kind: "ollama", host: null, isCloud: false, model: "test" })),
}));
import {
  labelledTicket,
  previewFerryText,
  ticketLocalTime,
  ticketNumber,
  verifiedModelTickets,
} from "../ticketPreview";
import { llmRefusalFor } from "../../llm/llmGate";
import { llmGenerateChain } from "../../llm/llmProvider";
const text =
  "Ferry ticket\nDeparture port: Bari\nArrival port: Durrës\nDeparture: 20.10.2026 22:00\nArrival: 21.10.2026 08:00\nVehicle length: 7,40 m\nPassengers: 2\nTotal price: 1.234,50 EUR\nBooking reference: ADR-123";
beforeEach(() => {
  jest.clearAllMocks();
});
it("reads labelled facts with evidence and explicit local dates without asking a model", async () => {
  const result = await previewFerryText(text, "user");
  expect(result.parser).toBe("labels");
  expect(llmGenerateChain).not.toHaveBeenCalled();
  expect(result.crossings[0]).toMatchObject({
    departurePort: { value: "Bari", evidence: "Bari" },
    departureLocal: { value: "2026-10-20T22:00" },
    vehicleLengthM: { value: "7.4" },
    price: { value: "1234.5" },
    currency: { value: "EUR" },
  });
});
it.each(["10/11/2026 22:00", "20.10. 22:00", "31.02.2026 12:00", "2026-10-20 25:00"])(
  "does not guess ambiguous/invalid local date %s",
  (raw) => expect(ticketLocalTime(raw)).toBeNull()
);
it("preserves date-only precision", () => expect(ticketLocalTime("2026-10-20")).toBe("2026-10-20"));
it("does not turn negative totals into positive prices", () =>
  expect(ticketNumber("-42,50 EUR")).toBeNull());
it("does not conflate repeated outbound and return fields or treat cm as metres", () => {
  const result = labelledTicket(text + "\nDeparture port: Durrës\nVehicle height: 310 cm");
  expect(result.departurePort).toBeUndefined();
  expect(result.vehicleHeightM).toBeUndefined();
});
it("drops model hallucinations, unknown fields, wrong times and unsupported numbers", () => {
  const out = verifiedModelTickets(
    {
      crossings: [
        {
          departurePort: { value: "Venice", evidence: "Bari" },
          arrivalPort: { value: "Durrës", evidence: "Durrës" },
          price: { value: "999", evidence: "1.234,50 EUR" },
          arrivalLocal: { value: "2026-10-22T08:00", evidence: "21.10.2026 08:00" },
          lat: { value: "41", evidence: "41" },
        },
      ],
    },
    text
  );
  expect(out).toEqual([{ arrivalPort: { value: "Durrës", evidence: "Durrës" } }]);
});
it("respects the admin/shared-demo refusal before any provider call", async () => {
  jest.mocked(llmRefusalFor).mockResolvedValue({ kind: "disabled_by_admin", reason: "disabled" });
  const result = await previewFerryText(
    "Unfamiliar ferry ticket format without labelled values",
    "user"
  );
  expect(result.reason).toBe("disabled_by_admin");
  expect(llmGenerateChain).not.toHaveBeenCalled();
});
it("uses the configured provider for unfamiliar layouts and keeps only evidenced fields", async () => {
  jest.mocked(llmRefusalFor).mockResolvedValue(null);
  jest.mocked(llmGenerateChain).mockResolvedValue({
    text: JSON.stringify({ crossings: [{ departurePort: { value: "Bari", evidence: "Bari" } }] }),
    target: { url: "http://localhost:11434", model: "test" },
  });
  const result = await previewFerryText("Ferry ticket for the sailing from Bari to Durrës", "user");
  expect(result.parser).toBe("llm");
  expect(result.crossings).toHaveLength(1);
});
