import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFlightSelectionStore } from "../../store/flightSelectionStore";
import type { Flight } from "../../types";

const mockFlight = (id: string): Flight => ({
  id,
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
  arrivalTime: "2024-03-14T13:45:00Z",
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
});

describe("useFlightSelectionStore", () => {
  beforeEach(() => {
    useFlightSelectionStore.setState({
      selectedIds: [],
      selectedFlights: [],
      highlightMode: null,
    });
  });

  it("initializes with empty selection", () => {
    const { result } = renderHook(() => useFlightSelectionStore());
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectedFlights).toEqual([]);
    expect(result.current.highlightMode).toBeNull();
  });

  it("sets single selection and highlightMode to 'single'", () => {
    const { result } = renderHook(() => useFlightSelectionStore());
    const flight = mockFlight("f1");
    act(() => result.current.setSelection([flight]));
    expect(result.current.selectedIds).toEqual(["f1"]);
    expect(result.current.selectedFlights).toEqual([flight]);
    expect(result.current.highlightMode).toBe("single");
  });

  it("sets group selection and highlightMode to 'group' for multiple ids", () => {
    const { result } = renderHook(() => useFlightSelectionStore());
    const f1 = mockFlight("f1");
    const f2 = mockFlight("f2");
    act(() => result.current.setSelection([f1, f2]));
    expect(result.current.selectedIds).toEqual(["f1", "f2"]);
    expect(result.current.selectedFlights).toEqual([f1, f2]);
    expect(result.current.highlightMode).toBe("group");
  });

  it("clearSelection resets all state", () => {
    const { result } = renderHook(() => useFlightSelectionStore());
    act(() => result.current.setSelection([mockFlight("f1")]));
    act(() => result.current.clearSelection());
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectedFlights).toEqual([]);
    expect(result.current.highlightMode).toBeNull();
  });
});
