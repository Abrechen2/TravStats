import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FlightPanel } from "../../components/FlightPanel";
import type { Flight } from "../../types";

vi.mock("../../store/flightSelectionStore", () => ({
  useFlightSelectionStore: vi.fn(() => ({
    selectedIds: [],
    selectedFlights: [],
    highlightMode: null,
    setSelection: vi.fn(),
    clearSelection: vi.fn(),
  })),
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const flights: Flight[] = [
  {
    id: "f1",
    userId: "u1",
    airline: "LH",
    flightNumber: "LH404",
    depIata: "MUC",
    arrIata: "JFK",
    depLat: 48.35,
    depLon: 11.79,
    arrLat: 40.64,
    arrLon: -73.78,
    departureTime: "2024-03-14T10:00:00Z",
    arrivalTime: "2024-03-14T19:45:00Z",
    status: "flown",
    createdAt: "2024-03-14T00:00:00Z",
  },
];

describe("FlightPanel", () => {
  it("renders flight list when open", () => {
    render(
      <FlightPanel
        flights={flights}
        totalCount={42}
        isOpen={true}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    expect(screen.getByText("MUC → JFK")).toBeInTheDocument();
  });

  it("shows total count in header", () => {
    render(
      <FlightPanel
        flights={flights}
        totalCount={42}
        isOpen={true}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <FlightPanel
        flights={flights}
        totalCount={1}
        isOpen={true}
        onClose={onClose}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "Panel schließen" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <FlightPanel
        flights={flights}
        totalCount={1}
        isOpen={false}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onAddFlight={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
