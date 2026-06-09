import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlightGroupItem } from "../../components/FlightPanel/FlightGroupItem";
import type { Flight } from "../../types";

// vi.hoisted lets us declare values that survive vi.mock factory hoisting
// and stay reachable from the test bodies. setSelection is shared between
// the mock factory (where the store returns it) and the assertions below.
const mocks = vi.hoisted(() => ({ setSelection: vi.fn() }));

vi.mock("../../store/flightSelectionStore", () => {
  const state = {
    selectedIds: [] as string[],
    selectedFlights: [],
    highlightMode: null,
    detailMode: null,
    setSelection: mocks.setSelection,
    clearSelection: vi.fn(),
    showDetails: vi.fn(),
  };
  return {
    useFlightSelectionStore: vi.fn(<T,>(selector?: (s: typeof state) => T) =>
      selector ? selector(state) : state
    ),
  };
});

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
    expect(mocks.setSelection).toHaveBeenCalledWith([leg1, leg2]);
  });
});
