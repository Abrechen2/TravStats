import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlightEntry } from "../../components/FlightPanel/FlightEntry";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import type { Flight } from "../../types";

vi.mock("../../store/flightSelectionStore", () => {
  const setSelection = vi.fn();
  const clearSelection = vi.fn();
  return {
    useFlightSelectionStore: vi.fn(() => ({
      selectedIds: [],
      selectedFlights: [],
      highlightMode: null,
      setSelection,
      clearSelection,
    })),
  };
});

const flight: Flight = {
  id: "f1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH404",
  depIata: "MUC",
  depLat: 48.35,
  depLon: 11.79,
  arrIata: "JFK",
  arrLat: 40.64,
  arrLon: -73.78,
  departureTime: "2024-03-14T10:00:00Z",
  arrivalTime: "2024-03-14T19:45:00Z",
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
};

describe("FlightEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders route and date", () => {
    render(
      <FlightEntry flight={flight} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />
    );
    expect(screen.getByText("MUC → JFK")).toBeInTheDocument();
    expect(screen.getByText(/14\.3\.2024/)).toBeInTheDocument();
  });

  it("calls setSelection with flight on click", () => {
    const mockStore = useFlightSelectionStore() as unknown as {
      setSelection: ReturnType<typeof vi.fn>;
    };
    render(
      <FlightEntry flight={flight} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(mockStore.setSelection).toHaveBeenCalledWith([flight]);
  });

  it("shows stats when stats toggle is clicked", () => {
    render(
      <FlightEntry flight={flight} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />
    );
    // Hover to show quick actions
    fireEvent.mouseEnter(screen.getByRole("button"));
    fireEvent.click(screen.getByLabelText("Stats"));
    expect(screen.getByText(/km/)).toBeInTheDocument();
  });
});
