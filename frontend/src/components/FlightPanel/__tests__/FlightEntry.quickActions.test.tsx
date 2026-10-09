/**
 * Review I5 (fix round 1): the dashboard panel's quick actions — the delete
 * among them — were drawn on mouse hover only, out of reach for a finger and
 * for the keyboard.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Flight } from "../../../types";
import { FlightEntry, quickActionsVisible } from "../FlightEntry";

const flight = {
  id: "f1",
  airline: "LH",
  flightNumber: "LH1",
  depIata: "MUC",
  arrIata: "CPH",
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T11:30:00.000Z",
  status: "flown",
  createdAt: "2026-01-01T00:00:00.000Z",
} as Flight;

function pointer(coarse: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: coarse && query.includes("coarse"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }))
  );
}

const renderEntry = () =>
  render(<FlightEntry flight={flight} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);

describe("FlightEntry quick actions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("are shown on hover, on a coarse pointer, with focus inside, or for the selected row", () => {
    const off = { hovered: false, coarse: false, focusWithin: false, selected: false };
    expect(quickActionsVisible(off)).toBe(false);
    for (const key of ["hovered", "coarse", "focusWithin", "selected"] as const) {
      expect(quickActionsVisible({ ...off, [key]: true })).toBe(true);
    }
  });

  it("are there without a hover on a coarse pointer, at touch size", () => {
    pointer(true);
    renderEntry();
    const del = screen.getByRole("button", { name: "common:buttons.delete" });
    expect(del.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
    expect(del.className).toContain("pointer-coarse:min-w-(--ts-size-touch-min)");
  });

  it("appear when the keyboard reaches the row", async () => {
    pointer(false);
    renderEntry();
    expect(screen.queryByRole("button", { name: "common:buttons.delete" })).toBeNull();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "common:buttons.delete" })).toBeInTheDocument();
  });

  it("names the status in the reader's language", () => {
    pointer(false);
    render(
      <FlightEntry
        flight={{ ...flight, status: "cancelled" }}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    expect(screen.getByText("flights:status.cancelled")).toBeInTheDocument();
  });
});
