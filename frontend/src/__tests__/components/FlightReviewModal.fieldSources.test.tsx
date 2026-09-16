import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import FlightReviewModal from "../../components/FlightReviewModal";
import type { ParsedBooking } from "../../types";

const noop = async () => {};

const parsedData: ParsedBooking = {
  flightNumber: "LH2460",
  departureCode: "MUC",
  arrivalCode: "HEL",
  missing: [],
  fieldSources: {
    flightNumber: "template",
    departureCode: "template",
    arrivalCode: "llm",
  },
};

vi.mock("../../lib/api", () => ({
  airportsApi: { search: vi.fn().mockResolvedValue([]) },
  parseApi: { submitParserCorrection: vi.fn() },
}));
vi.mock("../../store/authStore", () => ({
  useAuthStore: () => ({ user: { id: "u1" } }),
}));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({ features: { enableCostTracking: false } }),
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// The aircraft suggestion list loads on mount; an empty list is what the failed
// request already produced (forgejo#110).
//
// Airlines TOO. `useSuggestions` fetches them after a 300 ms debounce, so a
// test that finishes quickly never sees the request and a slow one does: the
// click test takes ~500 ms under coverage instrumentation, and CI's Vitest job
// went red on "reached the network once: GET /suggestions/airlines" as soon as
// it started collecting coverage (forgejo#62). Mocking only `aircraft` was a
// guard that held by timing, not by construction.
vi.mock("@/lib/api/suggestions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/suggestions")>();
  return {
    ...actual,
    suggestionsApi: {
      ...actual.suggestionsApi,
      aircraft: vi.fn().mockResolvedValue([]),
      airlines: vi.fn().mockResolvedValue([]),
    },
  };
});

describe("FlightReviewModal fieldSources", () => {
  it("applies green border class for template-sourced flight number field", () => {
    render(
      <FlightReviewModal
        isOpen={true}
        onClose={noop as unknown as () => void}
        onConfirm={noop}
        initialData={parsedData}
        source="email"
      />
    );
    const input = screen.getByDisplayValue("LH2460");
    expect(input.className).toMatch(/border-green/);
  });
});

describe("FlightReviewModal parser info", () => {
  const parsedWithMeta: ParsedBooking = {
    flightNumber: "LH105",
    departureCode: "MUC",
    arrivalCode: "FRA",
    missing: [],
    parserTemplate: "Lufthansa Buchungsdetails",
    parserConfidence: 75,
    fieldSources: { flightNumber: "template" },
  };

  it("renders parser template name when parserTemplate is set", () => {
    render(
      <FlightReviewModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={async () => {}}
        initialData={parsedWithMeta}
        source="email"
      />
    );
    expect(screen.getByText("Lufthansa Buchungsdetails")).toBeInTheDocument();
  });

  it("renders confidence pill when parserConfidence is set", () => {
    render(
      <FlightReviewModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={async () => {}}
        initialData={parsedWithMeta}
        source="email"
      />
    );
    expect(screen.getByText(/75/)).toBeInTheDocument();
  });

  it("shows source text panel when toggle is clicked", async () => {
    const user = userEvent.setup();
    const { getByText, queryByText } = render(
      <FlightReviewModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={async () => {}}
        initialData={parsedWithMeta}
        source="email"
        originalData={{ text: "Buchungscode: K9NB9B\nFlug: LH105" }}
      />
    );
    expect(queryByText(/Buchungscode: K9NB9B/)).not.toBeInTheDocument();
    await user.click(getByText("flights:review.sourceText"));
    expect(getByText(/Buchungscode: K9NB9B/)).toBeInTheDocument();
  });

  it("does not render parser info row when both parserTemplate and parserConfidence are absent", () => {
    const { container } = render(
      <FlightReviewModal
        isOpen={true}
        onClose={() => {}}
        onConfirm={async () => {}}
        initialData={{ flightNumber: "LH1", departureCode: "MUC", arrivalCode: "FRA", missing: [] }}
        source="email"
      />
    );
    expect(container.querySelector("[data-testid='parser-info-row']")).toBeNull();
  });
});
