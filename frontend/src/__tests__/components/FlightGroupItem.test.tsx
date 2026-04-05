import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlightGroupItem } from "../../components/FlightPanel/FlightGroupItem";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import type { Flight } from "../../types";

const setSelection = vi.fn();
vi.mock("../../store/flightSelectionStore", () => ({
  useFlightSelectionStore: vi.fn(() => ({
    selectedIds: [],
    selectedFlights: [],
    highlightMode: null,
    setSelection,
    clearSelection: vi.fn(),
  })),
}));

const leg1: Flight = {
  id: "f1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH100",
  depIata: "MUC",
  arrIata: "FRA",
  depLat: 48.35,
  depLon: 11.79,
  arrLat: 50.03,
  arrLon: 8.57,
  departureTime: "2024-03-14T08:00:00Z",
  arrivalTime: "2024-03-14T09:00:00Z",
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
};

const leg2: Flight = {
  id: "f2",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH402",
  depIata: "FRA",
  arrIata: "JFK",
  depLat: 50.03,
  depLon: 8.57,
  arrLat: 40.64,
  arrLon: -73.78,
  departureTime: "2024-03-14T11:00:00Z",
  arrivalTime: "2024-03-14T14:00:00Z",
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
};

describe("FlightGroupItem", () => {
  it("renders both legs", () => {
    render(
      <FlightGroupItem
        flights={[leg1, leg2]}
        label="MUC → FRA → JFK"
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText("MUC → FRA")).toBeInTheDocument();
    expect(screen.getByText("FRA → JFK")).toBeInTheDocument();
  });

  it("shows group label and leg count", () => {
    render(
      <FlightGroupItem
        flights={[leg1, leg2]}
        label="MUC → FRA → JFK"
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText(/MUC → FRA → JFK/)).toBeInTheDocument();
    expect(screen.getByText(/2 Legs/)).toBeInTheDocument();
  });

  it("calls setSelection with all flights on footer click", () => {
    render(
      <FlightGroupItem
        flights={[leg1, leg2]}
        label="MUC → FRA → JFK"
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText(/MUC → FRA → JFK/));
    expect(setSelection).toHaveBeenCalledWith([leg1, leg2]);
  });
});
