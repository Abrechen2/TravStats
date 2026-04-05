import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapTooltip } from "../../components/MapTooltip";
import type { Flight } from "../../types";

const flight: Flight = {
  id: "f1",
  userId: "u1",
  airline: "Lufthansa",
  flightNumber: "LH404",
  depIata: "MUC",
  arrIata: "JFK",
  aircraft: "A350",
  depLat: 48.35,
  depLon: 11.79,
  arrLat: 40.64,
  arrLon: -73.78,
  departureTime: "2024-03-14T10:00:00Z",
  arrivalTime: "2024-03-14T19:45:00Z",
  seatClass: "business",
  co2Kg: 0.9,
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
};

describe("MapTooltip", () => {
  it("renders route header", () => {
    render(
      <MapTooltip flight={flight} screenX={300} screenY={200} onEdit={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText("MUC → JFK")).toBeInTheDocument();
  });

  it("renders airline and flight number", () => {
    render(
      <MapTooltip flight={flight} screenX={300} screenY={200} onEdit={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText(/Lufthansa/)).toBeInTheDocument();
    expect(screen.getByText(/LH404/)).toBeInTheDocument();
  });

  it("renders distance and duration", () => {
    render(
      <MapTooltip flight={flight} screenX={300} screenY={200} onEdit={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText(/km/)).toBeInTheDocument();
    expect(screen.getByText(/h.*m/)).toBeInTheDocument();
  });

  it("calls onEdit when Bearbeiten is clicked", () => {
    const onEdit = vi.fn();
    render(
      <MapTooltip flight={flight} screenX={300} screenY={200} onEdit={onEdit} onClose={vi.fn()} />
    );
    fireEvent.click(screen.getByText("✏️ Bearbeiten"));
    expect(onEdit).toHaveBeenCalledWith(flight);
  });

  it("calls onClose when ✕ is clicked", () => {
    const onClose = vi.fn();
    render(
      <MapTooltip flight={flight} screenX={300} screenY={200} onEdit={vi.fn()} onClose={onClose} />
    );
    fireEvent.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
