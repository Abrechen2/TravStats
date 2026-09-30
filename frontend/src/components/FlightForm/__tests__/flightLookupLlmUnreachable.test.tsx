import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/useFlightEntrySuggestions", () => ({
  useFlightEntrySuggestions: () => ({
    seats: [],
    flightNumbers: [],
    frequentFlyerNumber: null,
    departureTerminals: [],
  }),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../lib/api/importBatches", () => ({ createImportBatch: vi.fn() }));
vi.mock("../../BoardingPassScanner", () => ({ default: () => null }));
// The drop zone stands in for the server: its two buttons deliver an empty
// flight parse, once with the LLM down and once with every reader asked.
vi.mock("../../import/EmailImportTab", () => ({
  default: ({
    onEmailResult,
    onPdfResult,
  }: {
    onEmailResult: (r: unknown) => void;
    onPdfResult: (r: unknown) => void;
  }) => (
    <>
      <button
        onClick={() => onEmailResult({ domain: "flight", flights: [], llmUnreachable: true })}
      >
        mail-llm-down
      </button>
      <button onClick={() => onEmailResult({ domain: "flight", flights: [] })}>mail-empty</button>
      <button
        onClick={() =>
          onPdfResult({ domain: "flight", flights: [], parserUsed: "regex", llmUnreachable: true })
        }
      >
        pdf-llm-down
      </button>
    </>
  ),
}));

import FlightLookupStep from "../FlightLookupStep";

/**
 * Silent-failure review 2026-09-26, finding 8: with Ollama down behind the
 * templates, an unread mail answered "Keine Flüge in der E-Mail gefunden".
 */
const noop = vi.fn();
const baseProps = {
  flightNumber: "",
  searchDate: "",
  loading: false,
  showScanner: false,
  sizedInputClass: "",
  setFlightNumber: noop,
  setSearchDate: noop,
  setShowScanner: noop,
  setStep: noop,
  handleFlightLookup: vi.fn(async () => undefined),
  handleBoardingPassScan: vi.fn(async () => undefined),
  setImportBatchId: noop,
  setParsedFlights: noop,
  setCurrentFlightIndex: noop,
  setParserProvider: noop,
  setOriginalEmailData: noop,
  setShowFlightReview: noop,
};

const renderWith = async (setError: (m: string) => void): Promise<void> => {
  await act(async () => {
    render(<FlightLookupStep {...baseProps} setError={setError} />);
  });
};

describe("FlightLookupStep — an empty parse says when the AI parser was down", () => {
  it.each([
    ["mail-llm-down", "flights:form.llmUnreachable"],
    ["pdf-llm-down", "flights:form.llmUnreachable"],
    ["mail-empty", "flights:form.noFlightsInEmail"],
  ])("%s → %s", async (button, message) => {
    const setError = vi.fn();
    await renderWith(setError);
    fireEvent.click(await screen.findByText(button));
    expect(setError).toHaveBeenCalledWith(message);
  });
});
