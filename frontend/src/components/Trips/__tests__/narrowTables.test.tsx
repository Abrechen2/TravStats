import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";
import type { EditorStation } from "../../../lib/roadtrip/editorStation";

vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]), deleteBooking: vi.fn() },
}));
vi.mock("../../../lib/api/roadtrips", () => ({
  roadtripsApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../../lib/api", () => ({ tripsApi: { deleteBooking: vi.fn() } }));

import { TripBookingsPanel } from "../TripBookingsPanel";
import ShiftDaysDialog from "../../Roadtrips/ShiftDaysDialog";

/**
 * Both tables sat bare in their card, so on a phone the operator/PNR/price
 * columns and the before/after dates widened the whole document instead of
 * scrolling inside their own region (the class of forgejo issue 290).
 */
describe("tables in a narrow card scroll in their own region", () => {
  it("the trip's bookings", () => {
    const trip = {
      id: "t1",
      bookings: [
        {
          id: "b1",
          userId: "u",
          tripId: "t1",
          pnr: "ABC123",
          price: 1200,
          currency: "EUR",
          operator: "TUI",
        },
      ],
    } as unknown as Trip;
    render(
      <TripBookingsPanel
        trip={trip}
        language="de"
        onChanged={() => {}}
        flightDay={() => ""}
        cruiseDay={() => ""}
      />
    );
    const region = screen.getByRole("region", { name: /\(1\)/ });
    expect(region).toHaveClass("overflow-x-auto");
    expect(region.querySelector("table")).not.toBeNull();
  });

  it("the day-shift preview", async () => {
    const st = (key: string, start: string, end: string): EditorStation => ({
      key,
      id: key,
      title: key,
      lat: 60,
      lon: 5,
      startDate: start,
      endDate: end,
      notes: null,
      night: { kind: "free" },
    });
    render(
      <MemoryRouter>
        <ShiftDaysDialog
          routeId="r1"
          tripId={null}
          drafts={[st("a", "2026-07-10", "2026-07-12"), st("b", "2026-07-12", "2026-07-14")]}
          fromIndex={0}
          lodgings={[]}
          onApply={() => {}}
          onClose={() => {}}
        />
      </MemoryRouter>
    );
    const table = await screen.findByTestId("shift-preview");
    const region = table.closest('[role="region"]');
    expect(region).not.toBeNull();
    expect(region).toHaveClass("overflow-x-auto");
    expect(region).toHaveAccessibleName();
  });
});
