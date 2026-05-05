import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SimplifiedFlightFormV2 from "../components/SimplifiedFlightFormV2";

vi.mock("../lib/api");
vi.mock("../store/settingsStore", () => ({
  useSettingsStore: vi.fn().mockReturnValue({
    features: { enableCostTracking: true },
    units: { distanceUnit: "kilometers", currency: "EUR" },
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
