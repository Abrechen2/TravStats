import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import FlightEditModal from "../../components/FlightEditModal";
import type { Flight } from "../../types";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ReceiptUpload", () => ({
  default: () => null,
}));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({
    features: { enableCostTracking: false },
  }),
}));

const mockFlight: Flight = {
  id: "1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH123",
  depLat: 50.033,
  depLon: 8.571,
  arrLat: 48.354,
  arrLon: 11.786,
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T11:00:00.000Z",
  status: "flown",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("FlightEditModal", () => {
  it("renders departure and arrival time inputs when modal is open", () => {
    render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(document.querySelector("#editDepartureTime")).toBeTruthy();
    expect(document.querySelector("#editArrivalTime")).toBeTruthy();
  });

  it("pre-fills departure time from flight data", () => {
    render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const input = document.querySelector("#editDepartureTime") as HTMLInputElement;
    // Value is formatted in local timezone — just verify it's not empty
    expect(input?.value).toBeTruthy();
  });

  it("shows year/month picker instead of datetime for historical flights", () => {
    const historicalFlight: Flight = {
      ...mockFlight,
      status: "historical",
      departureTime: null,
      arrivalTime: null,
    };
    render(
      <FlightEditModal flight={historicalFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    // datetime-local inputs should not be present
    expect(document.querySelector("#editDepartureTime")).toBeFalsy();
    // year number input should be present
    expect(document.querySelector('input[type="text"][inputmode="numeric"]')).toBeTruthy();
  });

  it("hides cost fields when enableCostTracking is false", () => {
    const { container } = render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    // Price input should not be present
    const priceInputs = container.querySelectorAll('input[type="number"][step="0.01"]');
    expect(priceInputs.length).toBe(0);
  });
});
