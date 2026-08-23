import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SimplifiedFlightFormV2 from "../components/SimplifiedFlightFormV2";
import { companionsApi } from "../lib/api";

vi.mock("../lib/api");
vi.mock("../store/settingsStore", () => ({
  useSettingsStore: vi.fn().mockReturnValue({
    features: { enableCostTracking: true },
    units: { distanceUnit: "kilometers" },
    defaults: {
      flightStatus: "scheduled",
      seatClass: "economy",
      favoriteAirline: "",
      flightCategory: "business",
    },
  }),
}));
vi.mock("../lib/geo", () => ({
  calculateDistance: vi.fn().mockReturnValue(1000),
}));
vi.mock("../lib/timeEstimation", () => ({
  storeHistoricalFlightTime: vi.fn(),
  estimateFlightTimes: vi.fn().mockReturnValue({
    arrivalTime: "14:00",
    source: "heuristic",
    confidence: "low",
  }),
}));

describe("SimplifiedFlightFormV2", () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // CompanionPicker (rendered on the "complete" step) fetches suggestions
    // via companionsApi.list() on mount — the bare `vi.mock("../lib/api")`
    // above auto-mocks every export to a vi.fn() returning undefined, which
    // makes CompanionPicker's `.then()` throw. Give it a resolvable promise.
    vi.mocked(companionsApi.list).mockResolvedValue([]);
  });

  it("should render flight form", () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    expect(screen.getByText(/flights:form\.title/i)).toBeInTheDocument();
  });

  it("should show error when airports are missing", async () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Navigate to complete step via manual entry action
    const skipButton = screen.getByText(/flights:form\.manualEntryAction/i);
    fireEvent.click(skipButton);

    await waitFor(() => {
      // Anchor on $ to match flights:form.submit and exclude submitAndReturn,
      // which was added when "Save + add return flight" got its own button.
      const submitButton = screen.getByRole("button", { name: /flights:form\.submit$/i });
      expect(submitButton).toBeDisabled();
    });
  });

  it("should validate required fields", async () => {
    render(<SimplifiedFlightFormV2 onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const skipButton = screen.getByText(/flights:form\.manualEntryAction/i);
    fireEvent.click(skipButton);

    await waitFor(() => {
      // Anchor on $ to match flights:form.submit and exclude submitAndReturn,
      // which was added when "Save + add return flight" got its own button.
      const submitButton = screen.getByRole("button", { name: /flights:form\.submit$/i });
      expect(submitButton).toBeInTheDocument();
      // Button should be disabled when airports are missing
      expect(submitButton).toBeDisabled();
    });
  });
});
