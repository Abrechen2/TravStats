import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import FlightEditModal from "../../components/FlightEditModal";
import type { Flight } from "../../types";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../components/ReceiptUpload", () => ({
  default: () => null,
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

describe("FlightEditModal actual times", () => {
  it("renders actual departure and arrival inputs when modal is open", () => {
    render(
      <FlightEditModal flight={mockFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(document.querySelector("#actualDeparture")).toBeTruthy();
    expect(document.querySelector("#actualArrival")).toBeTruthy();
  });

  it("pre-fills actualDeparture when flight has existing value", () => {
    const flightWithActual: Flight = {
      ...mockFlight,
      actualDeparture: "2026-06-01T10:15:00.000Z",
    };
    render(
      <FlightEditModal flight={flightWithActual} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const input = document.querySelector("#actualDeparture") as HTMLInputElement;
    expect(input?.value).toBe("2026-06-01T10:15");
  });
});
