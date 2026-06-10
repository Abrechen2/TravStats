import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickActions } from "../../components/FlightPanel/QuickActions";
import type { Flight } from "../../types";

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
  arrivalTime: "2024-03-14T13:45:00Z",
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
};

const noop = vi.fn();

describe("QuickActions", () => {
  it("renders 5 action buttons", () => {
    render(
      <QuickActions
        flight={flight}
        onEdit={noop}
        onMapFocus={noop}
        onStatsToggle={noop}
        onDuplicate={noop}
        onDelete={noop}
      />
    );
    expect(screen.getByLabelText("common:buttons.edit")).toBeInTheDocument();
    expect(screen.getByLabelText("flights:quickActions.showOnMap")).toBeInTheDocument();
    expect(screen.getByLabelText("flights:quickActions.stats")).toBeInTheDocument();
    expect(screen.getByLabelText("common:buttons.duplicate")).toBeInTheDocument();
    expect(screen.getByLabelText("common:buttons.delete")).toBeInTheDocument();
  });

  it("calls onEdit with flight when edit clicked", () => {
    const onEdit = vi.fn();
    render(
      <QuickActions
        flight={flight}
        onEdit={onEdit}
        onMapFocus={noop}
        onStatsToggle={noop}
        onDuplicate={noop}
        onDelete={noop}
      />
    );
    fireEvent.click(screen.getByLabelText("common:buttons.edit"));
    expect(onEdit).toHaveBeenCalledWith(flight);
  });

  it("calls onDelete with flightId when delete clicked", () => {
    const onDelete = vi.fn();
    render(
      <QuickActions
        flight={flight}
        onEdit={noop}
        onMapFocus={noop}
        onStatsToggle={noop}
        onDuplicate={noop}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByLabelText("common:buttons.delete"));
    expect(onDelete).toHaveBeenCalledWith("f1");
  });

  it("calls onMapFocus when map button clicked", () => {
    const onMapFocus = vi.fn();
    render(
      <QuickActions
        flight={flight}
        onEdit={noop}
        onMapFocus={onMapFocus}
        onStatsToggle={noop}
        onDuplicate={noop}
        onDelete={noop}
      />
    );
    fireEvent.click(screen.getByLabelText("flights:quickActions.showOnMap"));
    expect(onMapFocus).toHaveBeenCalledTimes(1);
  });
});
